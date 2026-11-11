import { readFileSync, lstatSync, readlinkSync, realpathSync } from "node:fs";
import { resolve, relative, sep } from "node:path";
import { run, binary } from "./process.mjs";
import { createReport, digest } from "./report.mjs";
import { analyzeChangedLines, analyzeSnapshot, compareSnapshots } from "./metric-analysis.mjs";
import { changedLines } from "./metric-plugins/diff-lines.mjs";
import { physicalLines } from "./metric-plugins/text-shape.mjs";
import { createSyntaxAnalyzer } from "./syntax/analyzer.mjs";

function reference(git, ref) {
  if (typeof ref !== "string" || !ref || ref.includes("\0")) throw new Error("An explicit base reference is required");
  return git(["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]).trim();
}

function numstats(buffer) {
  const tokens = buffer.toString("utf8").split("\0");
  const result = [];
  for (let index = 0; index < tokens.length && tokens[index]; index++) {
    const match = /^([0-9]+|-)\t([0-9]+|-)\t([\s\S]*)$/.exec(tokens[index]);
    if (!match) throw new Error("Unrecognized Git numstat output");
    const [, additions, deletions, name] = match;
    const previousPath = name ? null : tokens[++index];
    const path = name || tokens[++index];
    if (!path) throw new Error("Missing Git diff path");
    result.push({
      path, previousPath,
      additions: additions === "-" ? 0 : Number(additions),
      deletions: deletions === "-" ? 0 : Number(deletions),
      gitBinary: additions === "-",
    });
  }
  return result;
}

function statuses(buffer) {
  const tokens = buffer.toString("utf8").split("\0");
  const result = new Map();
  for (let index = 0; tokens[index]; index++) {
    const status = tokens[index];
    const first = tokens[++index];
    const path = /^[RC]/.test(status) ? tokens[++index] : first;
    if (!path) throw new Error("Missing status path");
    result.set(path, { status: {
      A: "added", D: "removed", M: "modified", T: "type-changed", R: "renamed", C: "copied",
    }[status[0]] ?? "unknown", previousPath: /^[RC]/.test(status) ? first : null });
  }
  return result;
}

function workingBlob(root, path) {
  const full = resolve(root, path);
  if (relative(root, full).startsWith(`..${sep}`) || relative(root, full) === "..") {
    throw new Error(`Path escapes repository: ${path}`);
  }
  const stat = lstatSync(full);
  if (stat.isSymbolicLink()) return Buffer.from(readlinkSync(full));
  if (!stat.isFile()) throw new Error(`Unsupported working-tree entry: ${path}`);
  const real = realpathSync(full);
  if (relative(root, real).startsWith(`..${sep}`) || relative(root, real) === "..") {
    throw new Error(`File resolves outside repository: ${path}`);
  }
  return readFileSync(full);
}

export class LocalDiffRequestError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function getLocalFileDiff({ cwd = process.cwd(), report, scope, path,
  maxOutputBytes = 256 * 1024 } = {}) {
  if (!report || report.source?.kind !== "local") {
    throw new LocalDiffRequestError(400, "Local diffs require a local report");
  }
  if (typeof path !== "string" || !path || path.includes("\0")) {
    throw new LocalDiffRequestError(400, "A valid file path is required");
  }
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1) {
    throw new RangeError("Diff output limit must be a positive safe integer");
  }

  const root = realpathSync(cwd);
  if (report.source.repository !== root) {
    throw new LocalDiffRequestError(409, "Local report belongs to a different checkout");
  }
  const commitMatch = /^commit:(0|[1-9]\d*)$/.exec(scope ?? "");
  let files, args, untracked = false;
  if (scope === "whole") {
    files = report.metrics.fileMetrics;
    args = [report.comparison.mergeBaseSha, report.comparison.headSha];
  } else if (commitMatch) {
    const commit = report.commits[Number(commitMatch[1])];
    if (!commit) throw new LocalDiffRequestError(400, "Commit scope is unavailable");
    files = commit.metrics.fileMetrics;
    args = [commit.parentSha, commit.sha];
  } else {
    const layer = report.layers.find((item) => item.id === scope);
    if (!layer) throw new LocalDiffRequestError(400, "Local scope is unavailable");
    files = layer.metrics.fileMetrics;
    if (layer.id === "index") args = ["--cached", report.comparison.headSha];
    else if (layer.id === "working") args = [];
    else if (layer.id === "untracked") {
      args = [];
      untracked = true;
    } else throw new LocalDiffRequestError(400, "Local scope is unsupported");
  }

  const file = files.find((item) => item.path === path);
  if (!file) throw new LocalDiffRequestError(404, "File is not part of this scope");
  if (file.binary) return { binary: true, diff: "" };

  const common = ["--no-ext-diff", "--no-textconv", "--no-color", "--unified=3"];
  const git = (gitArgs) => run("git", [
    "--no-pager", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false",
    "-c", "core.quotePath=false", "diff", ...gitArgs,
  ], {
    cwd: root, maxBuffer: maxOutputBytes, allowedExitCodes: [0, 1],
  });
  try {
    if (untracked) {
      const fullPath = resolve(root, path);
      const bytes = workingBlob(root, path);
      if (lstatSync(fullPath).isSymbolicLink()) {
        return { binary: false, diff: `Symbolic link target: ${bytes.toString("utf8")}` };
      }
      return { binary: false, diff: git(["--no-index", ...common, "--", "/dev/null", path]) };
    }
    return { binary: false, diff: git([...common, ...args, "--", `:(literal)${path}`]) };
  } catch (error) {
    if (error.cause?.code === "ENOBUFS") return { tooLarge: true, diff: "" };
    throw error;
  }
}

export function analyzeLocal({ cwd = process.cwd(), base, includeWorking = false,
  maxCommits = 250, maxFiles = 3000, maxBlobBytes = 16 * 1024 * 1024,
  syntaxAnalyzer = createSyntaxAnalyzer() } = {}) {
  const gitOptions = ["--no-pager", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false"];
  const initialGit = (args, options = {}) => run("git", [...gitOptions, ...args], { cwd, ...options });
  const root = realpathSync(initialGit(["rev-parse", "--show-toplevel"]).trim());
  const git = (args, options = {}) => run("git", [...gitOptions, "-c", "core.quotePath=false", ...args], { cwd: root, ...options });
  const headSha = reference(git, "HEAD");
  const baseSha = reference(git, base);
  const mergeBaseSha = git(["merge-base", baseSha, headSha]).trim();
  const entries = git(["rev-list", "--reverse", "--topo-order", `${mergeBaseSha}..${headSha}`]).trim();
  const shas = entries ? entries.split("\n") : [];
  if (shas.length > maxCommits) throw new Error(`History has ${shas.length} commits; limit is ${maxCommits}`);
  const fingerprints = [];
  const measurements = new Map();
  const changeMeasurements = new Map();
  function snapshot(revision, path, bytes) {
    const key = `${revision}\0${path}`;
    if (!measurements.has(key)) {
      const syntax = syntaxAnalyzer(bytes, path);
      measurements.set(key, { syntax, metrics: analyzeSnapshot(bytes, path, { syntax }) });
    }
    return measurements.get(key);
  }

  const readBlob = (revision, path, status, side) => {
    if ((side === "before" && status === "added") || (side === "after" && status === "removed")) return null;
    if (revision === "working") {
      if (lstatSync(resolve(root, path)).size > maxBlobBytes) throw new Error(`Blob size limit exceeded: ${path}`);
      return workingBlob(root, path);
    }
    const object = revision === "index" ? `:${path}` : `${revision}:${path}`;
    if (git(["cat-file", "-t", object]).trim() !== "blob") {
      throw new Error(`Submodule or unsupported non-blob entry: ${path}`);
    }
    if (Number(git(["cat-file", "-s", object]).trim()) > maxBlobBytes) {
      throw new Error(`Blob size limit exceeded: ${path}`);
    }
    return git(["cat-file", "blob", object], { encoding: null });
  };

  function diff(before, after, args) {
    const common = ["--no-ext-diff", "--no-textconv", "--find-renames", "--ignore-submodules=none"];
    const raw = git(["diff", ...common, "--numstat", "-z", ...args, "--"], { encoding: null });
    const states = statuses(git(["diff", ...common, "--name-status", "-z", ...args, "--"], { encoding: null }));
    const records = numstats(raw);
    if (records.length > maxFiles) throw new Error(`File limit exceeded: ${records.length} files in one scope`);
    return records.map((entry) => {
      const state = states.get(entry.path);
      if (!state) throw new Error(`Diff changed while collecting: ${entry.path}`);
      const left = readBlob(before, state.previousPath ?? entry.path, state.status, "before");
      const right = readBlob(after, entry.path, state.status, "after");
      const isBinary = entry.gitBinary || (left !== null && binary(left)) || (right !== null && binary(right));
      fingerprints.push({ scope: `${before}:${after}`, path: entry.path,
        before: left === null ? null : digest(left), after: right === null ? null : digest(right) });
      let changes = null;
      if (!isBinary) {
        const key = `${before}\0${after}\0${entry.path}`;
        if (!changeMeasurements.has(key)) {
          let lines;
          if (state.status === "added" || state.status === "removed") {
            lines = { before: physicalLines(left?.toString("utf8") ?? ""), after: physicalLines(right?.toString("utf8") ?? "") };
          } else {
            const paths = [...new Set([state.previousPath, entry.path].filter(Boolean))].map((path) => `:(literal)${path}`);
            const patch = entry.additions || entry.deletions ? git(["diff", ...common, "--no-color", "--unified=0",
              "--output-indicator-new=+", "--output-indicator-old=-", "--output-indicator-context= ", ...args, "--", ...paths]) : "";
            lines = changedLines(patch, entry.additions, entry.deletions);
          }
          changeMeasurements.set(key, analyzeChangedLines(lines, state.previousPath ?? entry.path, entry.path));
        }
        changes = changeMeasurements.get(key);
      }
      const beforeSnapshot = snapshot(before, state.previousPath ?? entry.path, left);
      const afterSnapshot = snapshot(after, entry.path, right);
      return {
        path: entry.path, previousPath: state.previousPath, status: state.status,
        additions: isBinary ? 0 : entry.additions, deletions: isBinary ? 0 : entry.deletions,
        binary: isBinary, beforeBytes: left?.length ?? null, afterBytes: right?.length ?? null,
        patchState: isBinary ? "binary" : state.status === "renamed" && !entry.additions && !entry.deletions ? "rename-only" : "complete",
        syntax: { before: beforeSnapshot.syntax, after: afterSnapshot.syntax },
        alternativeMetrics: compareSnapshots(beforeSnapshot.metrics, afterSnapshot.metrics, changes),
      };
    });
  }

  const files = diff(mergeBaseSha, headSha, [mergeBaseSha, headSha]);
  const commits = shas.map((sha) => {
    const fields = git(["show", "-s", "--format=%P%n%s", sha]).trimEnd().split("\n");
    const parents = fields[0].split(" ").filter(Boolean);
    const parentSha = parents[0];
    if (!parentSha) throw new Error(`Root commit lacks a comparison parent: ${sha}`);
    return { sha, parentSha, parentCount: parents.length, subject: fields.slice(1).join("\n"),
      files: diff(parentSha, sha, [parentSha, sha]) };
  });
  const layers = [];
  if (includeWorking) {
    const capture = () => ({
      head: reference(git, "HEAD"),
      status: git(["status", "--porcelain=v1", "-z", "--untracked-files=all"], { encoding: null }).toString("base64"),
      index: git(["ls-files", "--stage", "-z"], { encoding: null }).toString("base64"),
      staged: git(["diff", "--no-ext-diff", "--no-textconv", "--binary", "--cached", headSha, "--"], { encoding: null }).toString("base64"),
      unstaged: git(["diff", "--no-ext-diff", "--no-textconv", "--binary", "--"], { encoding: null }).toString("base64"),
    });
    const starting = JSON.stringify(capture());
    layers.push({ id: "index", title: "Staged: HEAD to index", files: diff(headSha, "index", ["--cached", headSha]) });
    layers.push({ id: "working", title: "Unstaged: index to working tree", files: diff("index", "working", []) });
    const untracked = git(["ls-files", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean);
    if (untracked.length > maxFiles) throw new Error(`Untracked file limit exceeded: ${untracked.length}`);
    const untrackedFiles = untracked.map((path) => {
      if (lstatSync(resolve(root, path)).size > maxBlobBytes) throw new Error(`Blob size limit exceeded: ${path}`);
      const bytes = workingBlob(root, path);
      const isBinary = binary(bytes);
      fingerprints.push({ scope: "untracked", path, hash: digest(bytes) });
      const text = isBinary ? "" : bytes.toString("utf8");
      const lines = text ? text.split("\n").length - (text.endsWith("\n") ? 1 : 0) : 0;
      const beforeSnapshot = snapshot("absent", path, null);
      const afterSnapshot = snapshot("working", path, bytes);
      return { path, previousPath: null, status: "added", additions: lines, deletions: 0,
        binary: isBinary, beforeBytes: null, afterBytes: bytes.length, patchState: isBinary ? "binary" : "complete",
        syntax: { before: beforeSnapshot.syntax, after: afterSnapshot.syntax },
        alternativeMetrics: compareSnapshots(beforeSnapshot.metrics, afterSnapshot.metrics,
          isBinary ? null : analyzeChangedLines({ before: [], after: physicalLines(text) }, path)) };
    });
    layers.push({ id: "untracked", title: "Untracked files (not part of HEAD)", files: untrackedFiles });
    const ending = JSON.stringify(capture());
    if (starting !== ending) throw new Error("Working tree or index changed during analysis; rerun for a consistent snapshot");
    for (const fingerprint of fingerprints.filter((entry) =>
      entry.scope === "index:working" || entry.scope === "untracked")) {
      const expected = fingerprint.after ?? fingerprint.hash;
      if (expected && digest(workingBlob(root, fingerprint.path)) !== expected) {
        throw new Error(`Working content changed during analysis: ${fingerprint.path}`);
      }
    }
  }
  if (reference(git, "HEAD") !== headSha) throw new Error("HEAD changed during analysis; rerun");
  return createReport({
    source: { kind: "local", repository: root },
    title: `Local changes: ${base} ... HEAD`,
    comparison: { baseSha, mergeBaseSha, headSha,
      mutableContentHash: includeWorking ? digest(JSON.stringify(fingerprints)) : null },
    files, commits, layers,
    warnings: [
      "File roles are path heuristics. Text lines include comments and blanks; no coverage or behavior-equivalence claim.",
      ...(includeWorking ? ["Staged, unstaged, and untracked layers are separate comparisons; do not sum them into the final PR diff."] : []),
    ],
  });
}
