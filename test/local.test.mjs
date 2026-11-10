import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, renameSync, symlinkSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/process.mjs";
import { analyzeLocal, getLocalFileDiff } from "../src/local.mjs";
import { loadReport, saveReport } from "../src/report.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "rich-summary-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => run("git", args, { cwd: root });
  git("init", "--quiet");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  git("config", "commit.gpgsign", "false");
  return { root, git, write: (path, value) => writeFileSync(join(root, path), value),
    commit: (message) => { git("add", "--all"); git("commit", "--quiet", "-m", message); return git("rev-parse", "HEAD").trim(); } };
}

test("Explicit base and an existing HEAD are required", (t) => {
  const f = fixture(t);
  assert.throws(() => analyzeLocal({ cwd: f.root, base: "HEAD" }), /git failed/);
  f.write("a.py", "print(1)\n"); f.commit("base");
  assert.throws(() => analyzeLocal({ cwd: f.root }), /explicit base/);
  assert.throws(() => analyzeLocal({ cwd: f.root, base: "--help" }), /git failed/);
});

test("Commits, filenames with tabs, binary bytes and mutable layers stay distinct", async (t) => {
  const f = fixture(t);
  mkdirSync(join(f.root, "src"));
  f.write("src/a.py", "a = 1\n");
  f.write("logo.bin", Buffer.from([0, 1, 2]));
  const base = f.commit("base");
  f.write("src/a.py", "a = 2\nb = 3\n");
  f.write("logo.bin", Buffer.from([0, 1, 2, 3, 4]));
  f.write("tab\tname.go", "package sample\n");
  f.commit("change");
  const committed = analyzeLocal({ cwd: f.root, base });
  assert.equal(committed.commits.length, 1);
  assert.equal(committed.metrics.files, 3);
  assert.equal(committed.metrics.categories.binary.beforeBytes, 3);
  assert.equal(committed.metrics.categories.binary.afterBytes, 5);
  assert.ok(committed.metrics.fileMetrics.some((file) => file.path === "tab\tname.go"));
  f.write("src/a.py", "a = 4\nb = 3\n"); f.git("add", "src/a.py");
  f.write("src/a.py", "a = 4\nb = 5\n");
  f.write("new.py", "value = 1");
  const mutable = analyzeLocal({ cwd: f.root, base, includeWorking: true });
  assert.equal(mutable.layers.length, 3);
  assert.equal(mutable.layers[0].metrics.additions, 1);
  assert.equal(mutable.layers[1].metrics.additions, 1);
  assert.equal(mutable.layers[2].metrics.additions, 1);
  assert.notEqual(mutable.id, committed.id);
  assert.equal(analyzeLocal({ cwd: f.root, base, includeWorking: true }).id, mutable.id);
  const artifacts = join(f.root, "artifacts");
  await saveReport(artifacts, mutable);
  assert.deepEqual(await loadReport(artifacts, mutable.id), mutable);
  await assert.rejects(loadReport(artifacts, "../escape"), /Invalid report identity/);
});

test("Local file diffs match committed, staged, unstaged, and untracked scopes", (t) => {
  const f = fixture(t);
  mkdirSync(join(f.root, "src"));
  f.write("src/value.js", "value = 1\n");
  f.write("asset.bin", Buffer.from([0, 1, 2]));
  const base = f.commit("base");
  f.write("src/value.js", "value = 2\n");
  f.write("asset.bin", Buffer.from([0, 1, 2, 3]));
  f.commit("committed");
  f.write("src/value.js", "value = 3\n");
  f.git("add", "src/value.js");
  f.write("src/value.js", "value = 4\n");
  f.write("new.js", "value = 5\n");

  const report = analyzeLocal({ cwd: f.root, base, includeWorking: true });
  const diff = (scope, path, options = {}) => getLocalFileDiff({
    cwd: f.root, report, scope, path, ...options,
  });
  assert.match(diff("whole", "src/value.js").diff, /-value = 1\n\+value = 2/);
  assert.match(diff("commit:0", "src/value.js").diff, /-value = 1\n\+value = 2/);
  assert.match(diff("index", "src/value.js").diff, /-value = 2\n\+value = 3/);
  assert.match(diff("working", "src/value.js").diff, /-value = 3\n\+value = 4/);
  assert.match(diff("untracked", "new.js").diff, /\+value = 5/);
  assert.deepEqual(diff("whole", "asset.bin"), { binary: true, diff: "" });
  assert.throws(() => diff("working", "missing.js"), { statusCode: 404 });
  assert.deepEqual(diff("whole", "src/value.js", { maxOutputBytes: 32 }), { tooLarge: true, diff: "" });
  assert.throws(() => getLocalFileDiff({
    cwd: tmpdir(), report, scope: "whole", path: "src/value.js",
  }), { statusCode: 409 });
});

test("Zero-line binary rename preserves byte sizes and rename identity", (t) => {
  const f = fixture(t);
  f.write("before.bin", Buffer.from([0, 2, 8, 1]));
  const base = f.commit("base");
  renameSync(join(f.root, "before.bin"), join(f.root, "after.bin"));
  f.commit("rename");
  const report = analyzeLocal({ cwd: f.root, base });
  assert.equal(report.metrics.renames, 1);
  assert.equal(report.metrics.churn, 0);
  assert.equal(report.metrics.fileMetrics[0].previousPath, "before.bin");
  assert.equal(report.metrics.categories.binary.beforeBytes, 4);
  assert.equal(report.metrics.categories.binary.afterBytes, 4);
});

test("Untracked symlinks are measured as link text, not followed", (t) => {
  const f = fixture(t);
  f.write("a", "base"); const base = f.commit("base");
  symlinkSync("/nonexistent/outside", join(f.root, "link"));
  const report = analyzeLocal({ cwd: f.root, base, includeWorking: true });
  assert.equal(report.layers[2].files[0].afterBytes, Buffer.byteLength("/nonexistent/outside"));
});

test("Analysis does not execute configured filesystem-monitor hooks", (t) => {
  const f = fixture(t);
  f.write("a.py", "a\n"); const base = f.commit("base");
  const hook = join(f.root, ".git", "hooks", "measurement-fsmonitor");
  writeFileSync(hook, "#!/bin/sh\ntouch hook-was-run\n");
  chmodSync(hook, 0o700);
  f.git("config", "core.fsmonitor", hook);
  analyzeLocal({ cwd: f.root, base, includeWorking: true });
  assert.equal(existsSync(join(f.root, "hook-was-run")), false);
});

test("Removed files and non-UTF-8 binary additions retain absolute sizes", (t) => {
  const f = fixture(t);
  f.write("removed.py", "a\nb\n"); const base = f.commit("base");
  rmSync(join(f.root, "removed.py"));
  f.write("new.bin", Buffer.from([255, 254, 128]));
  f.commit("replace");
  const report = analyzeLocal({ cwd: f.root, base });
  assert.equal(report.metrics.deletions, 2);
  assert.equal(report.metrics.binaryFiles, 1);
  assert.equal(report.metrics.categories.binary.afterBytes, 3);
});

test("Collection budgets fail explicitly instead of dropping oversized files", (t) => {
  const f = fixture(t);
  f.write("a.py", "a\n"); const base = f.commit("base");
  f.write("a.py", "longer content\n"); f.commit("change");
  assert.throws(() => analyzeLocal({ cwd: f.root, base, maxBlobBytes: 4 }), /Blob size limit/);
  assert.throws(() => analyzeLocal({ cwd: f.root, base, maxFiles: 0 }), /File limit/);
  f.write("large.txt", "untracked content\n");
  assert.throws(() => analyzeLocal({ cwd: f.root, base: "HEAD", includeWorking: true, maxBlobBytes: 4 }), /Blob size limit/);
});

test("First-parent merge context is labeled separately from the net footprint", (t) => {
  const f = fixture(t);
  f.write("base", "a\n"); const base = f.commit("base");
  const branch = f.git("branch", "--show-current").trim();
  f.git("checkout", "-q", "-b", "feature");
  f.write("feature.py", "value = 1\n"); f.commit("feature");
  f.git("checkout", "-q", branch);
  f.write("upstream.go", "package sample\n"); const upstream = f.commit("upstream");
  f.git("checkout", "-q", "feature");
  f.git("merge", "--no-edit", branch);
  const report = analyzeLocal({ cwd: f.root, base: upstream });
  assert.equal(report.comparison.mergeBaseSha, upstream);
  assert.equal(report.metrics.files, 1);
  const merge = report.commits.find((commit) => commit.parentCount === 2);
  assert.ok(merge);
  assert.ok(merge.files.some((file) => file.path === "upstream.go"));
  assert.notEqual(base, upstream);
});
