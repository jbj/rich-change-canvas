import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { binary, createLimiter } from "./process.mjs";
import { analyzeChangedLines, analyzeSnapshot, compareSnapshots } from "./metric-analysis.mjs";
import { changedLines } from "./metric-plugins/diff-lines.mjs";
import { createSyntaxAnalyzer } from "./syntax/analyzer.mjs";

const execute = promisify(execFile);
const measureFile = createLimiter(8);

async function reconstructPatch(before, after, path, previousPath) {
  const directory = await mkdtemp(join(tmpdir(), "rich-change-diff-"));
  try {
    await Promise.all([
      writeFile(join(directory, "before"), before ?? Buffer.alloc(0)),
      writeFile(join(directory, "after"), after ?? Buffer.alloc(0)),
    ]);
    let output;
    try {
      ({ stdout: output } = await execute("git", ["--no-pager", "-c", "core.attributesFile=/dev/null",
        "diff", "--no-index", "--no-ext-diff", "--no-textconv", "--no-color", "--unified=3",
        "--", "before", "after"], { cwd: directory, maxBuffer: 128 * 1024 * 1024, timeout: 120_000 }));
    } catch (error) {
      if (error.code !== 1 || typeof error.stdout !== "string") throw error;
      output = error.stdout;
    }
    const hunk = output.indexOf("@@ ");
    return hunk < 0 ? "" : `--- ${before === null ? "/dev/null" : `a/${previousPath ?? path}`}\n` +
      `+++ ${after === null ? "/dev/null" : `b/${path}`}\n${output.slice(hunk)}`;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function createGithubFiles({ repository, api, maxBlobBytes = 16 * 1024 * 1024,
  syntaxAnalyzer = createSyntaxAnalyzer() }) {
  const prefix = `repos/${repository}`;
  const blobs = new Map();
  function blob(path, revision) {
    const key = `${revision}:${path}`;
    if (!blobs.has(key)) blobs.set(key, (async () => {
      const encoded = path.split("/").map(encodeURIComponent).join("/");
      const content = await api(`${prefix}/contents/${encoded}?ref=${revision}`);
      if (content.type !== "file" || !Number.isSafeInteger(content.size) || content.size < 0) {
        throw new Error(`Unsupported non-file GitHub object: ${path}`);
      }
      if (content.size > maxBlobBytes) throw new Error(`Blob size limit exceeded: ${path}`);
      let bytes;
      if (content.encoding === "base64") bytes = Buffer.from(content.content, "base64");
      else {
        const object = await api(`${prefix}/git/blobs/${content.sha}`);
        if (object.encoding !== "base64") throw new Error(`GitHub cannot return blob bytes: ${path}`);
        bytes = Buffer.from(object.content, "base64");
      }
      if (bytes.length !== content.size) throw new Error(`Incomplete blob bytes: ${path}`);
      const syntax = syntaxAnalyzer(bytes, path);
      return { bytes, binary: binary(bytes), syntax, metrics: analyzeSnapshot(bytes, path, { syntax }) };
    })());
    return blobs.get(key);
  }
  return async function files(records, parentSha, headSha) {
    return Promise.all(records.map((file) => measureFile(async () => {
      const path = file.filename ?? file.path;
      const previousPath = file.previous_filename ?? file.previousPath ?? null;
      if (file.status !== "added" && !parentSha) throw new Error(`Missing parent for existing file: ${path}`);
      const [before, after] = await Promise.all([
        file.status === "added" ? null : blob(previousPath ?? path, parentSha),
        file.status === "removed" ? null : blob(path, headSha),
      ]);
      const isBinary = before?.binary === true || after?.binary === true;
      const renameOnly = file.status === "renamed" && !file.additions && !file.deletions;
      let patch = file.patch ?? "";
      let lines = null;
      if (!isBinary) {
        try {
          lines = changedLines(patch, file.additions, file.deletions);
        } catch (error) {
          if (!/^(Incomplete unified diff hunk|Invalid unified diff hunk line|Inconsistent unified diff hunk|Incomplete changed-line evidence)$/.test(error.message)) throw error;
          // GitHub omits or truncates large patches; reconstruct from the exact blobs.
        }
        if (!lines) {
          patch = await reconstructPatch(before?.bytes ?? null, after?.bytes ?? null, path, previousPath);
          try {
            lines = changedLines(patch, file.additions, file.deletions);
          } catch (error) {
            throw new Error(`Cannot reconcile ${repository}@${headSha}:${path}: ${error.message}`, { cause: error });
          }
        }
      }
      const beforeSyntax = before?.syntax ?? syntaxAnalyzer(null, previousPath ?? path);
      const afterSyntax = after?.syntax ?? syntaxAnalyzer(null, path);
      return {
        path, previousPath, status: file.status,
        additions: isBinary ? 0 : file.additions, deletions: isBinary ? 0 : file.deletions,
        binary: isBinary, beforeBytes: before?.bytes.length ?? null, afterBytes: after?.bytes.length ?? null,
        patchState: isBinary ? "binary" : renameOnly ? "rename-only" : "complete",
        diff: { binary: isBinary, diff: isBinary ? "" : patch },
        syntax: { before: beforeSyntax, after: afterSyntax },
        alternativeMetrics: compareSnapshots(
          before?.metrics ?? analyzeSnapshot(null, previousPath ?? path, { syntax: beforeSyntax }),
          after?.metrics ?? analyzeSnapshot(null, path, { syntax: afterSyntax }),
          isBinary ? null : analyzeChangedLines(lines, previousPath ?? path, path)),
        addedRustTestAttributes: path.endsWith(".rs") ?
          lines?.after.filter((line) => /^\s*#\[(?:\w+::)*test(?:\]|\()/.test(line)).length ?? 0 : 0,
        removedRustTestAttributes: path.endsWith(".rs") ?
          lines?.before.filter((line) => /^\s*#\[(?:\w+::)*test(?:\]|\()/.test(line)).length ?? 0 : 0,
      };
    })));
  };
}
