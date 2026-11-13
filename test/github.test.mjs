import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyzePullRequest } from "../src/github.mjs";

function fixture({ missing = false, changeHead = false, binaryRename = false } = {}) {
  const file = binaryRename ?
    { filename: "new.bin", previous_filename: "old.bin", status: "renamed", additions: 0, deletions: 0 } :
    { filename: "main.go", status: "modified", additions: 1, deletions: 1,
      ...(missing ? {} : { patch: "@@ -1 +1 @@\n-old\n+new" }) };
  let metadataReads = 0;
  const pr = { title: "Test change", html_url: "https://github.com/test/repo/pull/1",
    base: { sha: "base" }, head: { sha: "head" }, state: "open", merged_at: null,
    changed_files: 1, commits: 1, comments: 0, review_comments: 0,
    additions: file.additions, deletions: file.deletions };
  const calls = [];
  const api = (path) => {
    calls.push(path);
    if (path === "repos/test/repo/pulls/1") {
      metadataReads++;
      return metadataReads > 1 && changeHead ? { ...pr, head: { sha: "changed" } } : pr;
    }
    if (path.includes("/compare/")) return { merge_base_commit: { sha: "merge-base" } };
    if (path.includes("/pulls/1/files?")) return [file];
    if (path.includes("/pulls/1/commits?")) return [{ sha: "head" }];
    if (path.includes("/commits/head?")) return { files: [file],
      parents: [{ sha: "parent" }, { sha: "upstream" }],
      stats: { additions: file.additions, deletions: file.deletions },
      commit: { message: "Merge context" }, html_url: "https://github.com/test/repo/commit/head" };
    if (path.includes("/contents/")) {
      const bytes = binaryRename ? Buffer.from([0, 1, 2]) : Buffer.from(path.endsWith("ref=head") ? "new\n" : "old\n");
      return { type: "file", size: bytes.length, encoding: "base64", content: bytes.toString("base64"), sha: "blob" };
    }
    throw new Error(`Unexpected API request: ${path}`);
  };
  return { api, calls, pr, file };
}

test("PR and merge-commit comparisons retain exact scope and immutable identity", async () => {
  const f = fixture();
  const report = await analyzePullRequest({ repository: "test/repo", number: 1, api: f.api });
  assert.equal(report.comparison.mergeBaseSha, "merge-base");
  assert.equal(report.metrics.churn, 2);
  assert.equal(report.commits[0].parentCount, 2);
  assert.equal(report.commits[0].parentSha, "parent");
  assert.equal(report.source.state, "open");
  assert.equal(report.structuralAnalysis.status, "available");
  assert.ok(Object.keys(report.syntaxSnapshots).length > 0);
});

test("Missing text patches are reconstructed from exact snapshots", async () => {
  const f = fixture({ missing: true });
  const report = await analyzePullRequest({ repository: "test/repo", number: 1, api: f.api });
  assert.equal(report.metrics.incomplete, 0);
  assert.equal(report.metrics.fileMetrics[0].beforeBytes, 4);
  assert.match(report.metrics.fileMetrics[0].diff.diff, /-old\n\+new/);
  assert.equal(report.commits[0].metrics.incomplete, 0);
  f.file.patch = "@@ -1 +1 @@\n-old";
  const truncated = await analyzePullRequest({ repository: "test/repo", number: 1, api: f.api });
  assert.equal(truncated.metrics.incomplete, 0);
  assert.equal(truncated.metrics.fileMetrics[0].diff.diff, report.metrics.fileMetrics[0].diff.diff);
});

test("Zero-line binary rename fetches both paths and exposes bytes", async () => {
  const f = fixture({ binaryRename: true });
  const report = await analyzePullRequest({ repository: "test/repo", number: 1, api: f.api });
  assert.equal(report.metrics.binaryFiles, 1);
  assert.equal(report.metrics.renames, 1);
  assert.equal(report.metrics.categories.binary.beforeBytes, 3);
  assert.equal(report.metrics.categories.binary.afterBytes, 3);
  assert.ok(f.calls.includes("repos/test/repo/contents/old.bin?ref=merge-base"));
  f.file.patch = "";
  const emptyPatch = await analyzePullRequest({ repository: "test/repo", number: 1, api: f.api });
  assert.equal(emptyPatch.metrics.binaryFiles, 1);
});

test("Modified renames use the old path in PR and original-commit patches, including reconstruction", async () => {
  for (const missing of [false, true]) {
    const f = fixture({ missing });
    Object.assign(f.file, { filename: "new.go", previous_filename: "old.go", status: "renamed" });
    const report = await analyzePullRequest({ repository: "test/repo", number: 1, api: f.api });
    for (const files of [report.metrics.fileMetrics, report.commits[0].metrics.fileMetrics]) {
      const [file] = files;
      assert.equal(file.previousPath, "old.go");
      assert.deepEqual([file.additions, file.deletions], [1, 1]);
      assert.match(file.diff.diff, /-old\n\+new/);
      assert.doesNotMatch(file.diff.diff, /\/dev\/null/);
      if (missing) assert.match(file.diff.diff, /--- a\/old\.go\n\+\+\+ b\/new\.go\n/);
    }
    assert.ok(f.calls.includes("repos/test/repo/contents/old.go?ref=merge-base"));
    assert.ok(f.calls.includes("repos/test/repo/contents/old.go?ref=parent"));
    assert.ok(f.calls.includes("repos/test/repo/contents/new.go?ref=head"));
    assert.equal(f.calls.some((path) => /contents\/new\.go\?ref=(merge-base|parent)$/.test(path)), false);
  }
});

test("Blob API fallback checks exact bytes and acquisition budgets", async () => {
  const f = fixture();
  const api = (path) => path.includes("/contents/") ? { type: "file", size: 5, encoding: "none", sha: "blob" } :
    path.endsWith("/git/blobs/blob") ? { encoding: "base64", content: Buffer.from("text\n").toString("base64") } : f.api(path);
  const report = await analyzePullRequest({ repository: "test/repo", number: 1, api });
  assert.equal(report.metrics.fileMetrics[0].beforeBytes, 5);
  await assert.rejects(() => analyzePullRequest({ repository: "test/repo", number: 1, api, maxBlobBytes: 4 }), /Blob size limit/);
  const truncated = (path) => path.endsWith("/git/blobs/blob") ?
    { encoding: "base64", content: "YQ==" } : api(path);
  await assert.rejects(() => analyzePullRequest({ repository: "test/repo", number: 1, api: truncated }), /Incomplete blob bytes/);
  const denied = () => { throw new Error("Permission denied"); };
  await assert.rejects(() => analyzePullRequest({ repository: "test/repo", number: 1, api: denied }), /Permission denied/);
});

test("Concurrent PR changes and metadata truncation fail explicitly", async () => {
  const f = fixture({ changeHead: true });
  await assert.rejects(() => analyzePullRequest({ repository: "test/repo", number: 1, api: f.api }), /changed during/);
  const broken = fixture();
  broken.pr.changed_files = 2;
  await assert.rejects(() => analyzePullRequest({ repository: "test/repo", number: 1, api: broken.api }), /Incomplete PR file/);
  const huge = fixture(); huge.pr.commits = 251;
  await assert.rejects(() => analyzePullRequest({ repository: "test/repo", number: 1, api: huge.api }), /supported limit/);
});

test("Validation rejects unsafe repository and invalid number inputs", async () => {
  for (const repository of ["--help", "../repo", "owner/..", "https://github.com/a/b"]) {
    await assert.rejects(() => analyzePullRequest({ repository, number: 1 }), /owner\/name/);
  }
  await assert.rejects(() => analyzePullRequest({ repository: "test/repo", number: 0 }), /positive integer/);
});

test("Complete patches fetch full snapshots by default and reuse scalar measurements across scopes", async () => {
  const f = fixture();
  const before = "# private_source_sentinel\nvalue = 1\n";
  const after = "# private_source_sentinel\nif value:\n    pass\n";
  const api = (path) => {
    if (!path.includes("/contents/")) return f.api(path);
    f.calls.push(path);
    const text = path.endsWith("ref=head") ? after : before;
    return { type: "file", size: Buffer.byteLength(text), encoding: "base64",
      content: Buffer.from(text).toString("base64"), sha: "blob" };
  };
  f.file.filename = "main.py";
  const report = await analyzePullRequest({ repository: "test/repo", number: 1, api });
  assert.equal(f.calls.filter((path) => path.includes("/contents/")).length, 3);
  assert.equal(f.calls.filter((path) => path.endsWith("/contents/main.py?ref=head")).length, 1);
  assert.equal(report.metrics.alternativeMetrics["decision-keywords"].before.value, 0);
  assert.equal(report.metrics.alternativeMetrics["decision-keywords"].after.value, 1);
  assert.equal(report.metrics.alternativeMetrics.bytes.after.value, Buffer.byteLength(after));
  assert.equal(report.metrics.incomplete, 0);
  assert.doesNotMatch(JSON.stringify(report), /private_source_sentinel/);
  await assert.rejects(() => analyzePullRequest({ repository: "test/repo", number: 1, api, maxBlobBytes: 2 }), /Blob size limit/);
});

test("GitHub metrics use changed patch lines rather than net snapshot count differences", async () => {
  const f = fixture();
  const untouched = "u".repeat(121), removed = "x".repeat(121);
  const added = Array.from({ length: 7 }, (_, index) => `${index}${"y".repeat(120)}`);
  f.file.filename = "main.js";
  f.file.additions = f.pr.additions = 7;
  f.file.patch = `@@ -1,2 +1,8 @@\n ${untouched}\n-${removed}\n${added.map((line) => `+${line}`).join("\n")}`;
  const api = (path) => {
    if (!path.includes("/contents/")) return f.api(path);
    const text = path.endsWith("ref=head") ? `${untouched}\n${added.join("\n")}\n` : `${untouched}\n${removed}\n`;
    return { type: "file", size: Buffer.byteLength(text), encoding: "base64",
      content: Buffer.from(text).toString("base64"), sha: "blob" };
  };
  const report = await analyzePullRequest({ repository: "test/repo", number: 1, api });
  const long = report.metrics.alternativeMetrics["long-lines"];
  assert.equal(long.before.value, 2);
  assert.equal(long.after.value, 8);
  assert.equal(long.changes.additions.value, 7);
  assert.equal(long.changes.deletions.value, 1);
  assert.deepEqual(report.commits[0].metrics.alternativeMetrics["long-lines"], long);
  delete f.file.patch;
  const missing = (await analyzePullRequest({ repository: "test/repo", number: 1, api })).metrics.alternativeMetrics["long-lines"];
  assert.equal(missing.before.value, 2);
  assert.equal(missing.after.value, 8);
  assert.equal(missing.changes.additions.status, "available");
  assert.equal(missing.changes.additions.value, 7);
  assert.equal(missing.changes.deletions.value, 1);
});

test("All 30 acquired PRs replay through the production adapter using their metadata", async () => {
  const corpus = JSON.parse(readFileSync(new URL("../research/corpus.json", import.meta.url), "utf8"));
  for (const sample of corpus.samples) {
    // Synthetic complete hunks test pagination and scopes, not original source content.
    const raw = (file) => ({ filename: file.path, previous_filename: file.previousPath,
      status: file.status, additions: file.additions, deletions: file.deletions,
      patch: `@@ -1,${file.deletions} +1,${file.additions} @@\n` +
        "-a\n".repeat(file.deletions) + "+b\n".repeat(file.additions) });
    const prefix = `repos/${sample.repository}`;
    const paginate = (records, path) => {
      const page = Number(new URL(`https://api.github.com/${path}`).searchParams.get("page"));
      return records.slice((page - 1) * 100, page * 100);
    };
    const api = (path) => {
      if (path === `${prefix}/pulls/${sample.number}`) return {
        title: sample.title, html_url: sample.url, base: { sha: sample.baseSha },
        head: { sha: sample.headSha }, changed_files: sample.files.length, commits: sample.commits.length,
        additions: sample.additions, deletions: sample.deletions, merged_at: sample.mergedAt,
        comments: sample.evidence.issueComments, review_comments: sample.evidence.inlineComments,
      };
      if (path.includes("/compare/")) return { merge_base_commit: { sha: sample.mergeBaseSha } };
      if (path.includes("/files?")) return paginate(sample.files.map(raw), path);
      if (path.includes(`/pulls/${sample.number}/commits?`)) return paginate(sample.commits, path);
      if (path.includes("/contents/")) return { type: "file", size: 1, sha: "text",
        encoding: "base64", content: "YQ==" };
      const commit = sample.commits.find((entry) => path.startsWith(`${prefix}/commits/${entry.sha}?`));
      if (commit) return { files: paginate(commit.files.map(raw), path),
        parents: Array.from({ length: commit.parentCount }, (_, index) => ({ sha: index ? "upstream" : commit.parentSha })),
        stats: { additions: commit.additions, deletions: commit.deletions },
        commit: { message: commit.subject }, html_url: commit.url };
      throw new Error(`Unexpected replay API request: ${path}`);
    };
    const report = await analyzePullRequest({ repository: sample.repository, number: sample.number, api });
    assert.equal(report.metrics.files, sample.files.length, sample.repository);
    assert.equal(report.metrics.additions, sample.additions, sample.repository);
    assert.equal(report.commits.length, sample.commits.length, sample.repository);
  }
});
