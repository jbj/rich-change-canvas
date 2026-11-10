import { run, binary } from "./process.mjs";
import { createReport } from "./report.mjs";
import { analyzeChangedLines, analyzeSnapshot, compareSnapshots } from "./metric-analysis.mjs";
import { changedLines } from "./metric-plugins/diff-lines.mjs";

export function githubApi(endpoint) {
  return JSON.parse(run("gh", ["api", endpoint]));
}

export function analyzePullRequest({ repository, number, maxCommits = 250,
  maxBlobBytes = 16 * 1024 * 1024, api = githubApi } = {}) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "") ||
      repository.split("/").some((part) => part === "." || part === "..")) {
    throw new Error("Repository must be owner/name");
  }
  if (!Number.isSafeInteger(number) || number < 1) throw new Error("PR number must be a positive integer");
  const prefix = `repos/${repository}`;
  const prPath = `${prefix}/pulls/${number}`;
  const pr = api(prPath);
  if (pr.commits > maxCommits || pr.commits > 250) {
    throw new Error(`PR has ${pr.commits} commits; supported limit is ${Math.min(maxCommits, 250)}`);
  }
  function pages(endpoint, extract = (value) => value) {
    const records = [];
    for (let page = 1; page <= 31; page++) {
      const response = api(`${endpoint}?per_page=100&page=${page}`);
      const items = extract(response);
      if (!Array.isArray(items)) throw new Error(`Expected paginated records: ${endpoint}`);
      records.push(...items);
      if (items.length < 100) return records;
    }
    throw new Error(`GitHub pagination limit reached: ${endpoint}`);
  }
  const comparison = api(`${prefix}/compare/${pr.base.sha}...${pr.head.sha}`);
  const mergeBaseSha = comparison.merge_base_commit.sha;
  const blobs = new Map();
  function blob(path, revision) {
    const key = `${revision}:${path}`;
    if (blobs.has(key)) return blobs.get(key);
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    const content = api(`${prefix}/contents/${encoded}?ref=${revision}`);
    if (content.type !== "file" || !Number.isSafeInteger(content.size)) {
      throw new Error(`Unsupported non-file GitHub object: ${path}`);
    }
    if (content.size > maxBlobBytes) throw new Error(`Blob size limit exceeded: ${path}`);
    let bytes;
    if (content.encoding === "base64") bytes = Buffer.from(content.content, "base64");
    else {
      const object = api(`${prefix}/git/blobs/${content.sha}`);
      if (object.encoding !== "base64") throw new Error(`GitHub cannot return blob bytes: ${path}`);
      bytes = Buffer.from(object.content, "base64");
    }
    if (bytes.length !== content.size) throw new Error(`Incomplete blob bytes: ${path}`);
    const result = { size: content.size, binary: binary(bytes), metrics: analyzeSnapshot(bytes, path) };
    blobs.set(key, result);
    return result;
  }
  function files(records, parentSha, headSha) {
    return records.map((file) => {
      const lines = file.patch?.split("\n") ?? [];
      const complete = typeof file.patch === "string" &&
        lines.filter((line) => line.startsWith("+")).length === file.additions &&
        lines.filter((line) => line.startsWith("-")).length === file.deletions;
      let before = null;
      let after = null;
      if (file.status !== "added") {
        if (!parentSha) throw new Error(`Missing parent for existing file: ${file.filename}`);
        before = blob(file.previous_filename ?? file.filename, parentSha);
      }
      if (file.status !== "removed") after = blob(file.filename, headSha);
      const isBinary = before?.binary === true || after?.binary === true;
      const renameOnly = file.status === "renamed" && !file.additions && !file.deletions;
      return {
        path: file.filename, previousPath: file.previous_filename ?? null, status: file.status,
        additions: isBinary ? 0 : file.additions, deletions: isBinary ? 0 : file.deletions,
        binary: isBinary, beforeBytes: before?.size ?? null, afterBytes: after?.size ?? null,
        patchState: isBinary ? "binary" : renameOnly ? "rename-only" : complete ? "complete" : "missing-or-truncated",
        alternativeMetrics: compareSnapshots(
          before?.metrics ?? analyzeSnapshot(null, file.previous_filename ?? file.filename),
          after?.metrics ?? analyzeSnapshot(null, file.filename),
          complete && !isBinary ? analyzeChangedLines(
            changedLines(file.patch, file.additions, file.deletions),
            file.previous_filename ?? file.filename, file.filename) : null),
        addedRustTestAttributes: file.filename.endsWith(".rs") ?
          lines.filter((line) => /^\+\s*#\[(?:\w+::)*test(?:\]|\()/.test(line)).length : 0,
        removedRustTestAttributes: file.filename.endsWith(".rs") ?
          lines.filter((line) => /^-\s*#\[(?:\w+::)*test(?:\]|\()/.test(line)).length : 0,
      };
    });
  }
  function reconcile(records, additions, deletions, label) {
    if (records.reduce((sum, file) => sum + file.additions, 0) !== additions ||
        records.reduce((sum, file) => sum + file.deletions, 0) !== deletions) {
      throw new Error(`Incomplete or stale ${label}: line totals do not reconcile`);
    }
  }
  const rawFiles = pages(`${prPath}/files`);
  if (rawFiles.length !== pr.changed_files) throw new Error("Incomplete PR file list");
  reconcile(rawFiles, pr.additions, pr.deletions, "PR");
  const wholeFiles = files(rawFiles, mergeBaseSha, pr.head.sha);
  const rawCommits = pages(`${prPath}/commits`);
  if (rawCommits.length !== pr.commits) throw new Error("Incomplete PR commit history");
  const commits = rawCommits.map((entry) => {
    let metadata;
    const records = pages(`${prefix}/commits/${entry.sha}`, (response) => {
      metadata ??= response;
      return response.files;
    });
    reconcile(records, metadata.stats.additions, metadata.stats.deletions, `commit ${entry.sha}`);
    const parentSha = metadata.parents[0]?.sha ?? null;
    return {
      sha: entry.sha, parentSha, parentCount: metadata.parents.length,
      subject: metadata.commit.message.split("\n")[0], url: metadata.html_url,
      files: files(records, parentSha, entry.sha),
    };
  });
  const latest = api(prPath);
  if (latest.head.sha !== pr.head.sha || latest.base.sha !== pr.base.sha ||
      latest.changed_files !== pr.changed_files || latest.commits !== pr.commits ||
      latest.additions !== pr.additions || latest.deletions !== pr.deletions) {
    throw new Error("PR changed during acquisition; rerun for a consistent snapshot");
  }
  return createReport({
    source: { kind: "github", repository, number, url: pr.html_url,
      state: pr.merged_at ? "merged" : pr.state, mergedAt: pr.merged_at,
      discussion: { issueComments: pr.comments, inlineComments: pr.review_comments,
        note: "Raw GitHub totals, including bots. Approval and human-discussion evidence were not collected by this baseline adapter." } },
    title: pr.title, comparison: { baseSha: pr.base.sha, mergeBaseSha, headSha: pr.head.sha },
    files: wholeFiles, commits,
    warnings: [
      "File roles are path heuristics. Test-line changes are not coverage or evidence of correctness.",
      "Each commit is compared with its first parent; merge context can contain upstream changes absent from the final PR.",
    ],
  });
}
