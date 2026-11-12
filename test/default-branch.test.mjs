import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/process.mjs";
import { resolveDefaultBranch, resolveReviewBase } from "../src/default-branch.mjs";
import { analyzeLocal, getLocalFileDiff } from "../src/local.mjs";

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), "rich-summary-branch-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => run("git", args, { cwd });
  git("init", "--quiet");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  writeFileSync(join(cwd, "base"), "base\n");
  git("add", "base");
  git("commit", "--quiet", "-m", "base");
  return { cwd, git };
}

test("Uses origin/HEAD when it points to an available default branch", (t) => {
  const f = fixture(t);
  f.git("update-ref", "refs/remotes/origin/main", "HEAD");
  f.git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  assert.equal(resolveDefaultBranch(f.cwd, () => {
    assert.fail("Should not query GitHub when origin/HEAD is configured");
  }), "origin/main");
});

test("Falls back to GitHub default branch metadata and uses its local remote ref", (t) => {
  const f = fixture(t);
  f.git("update-ref", "refs/remotes/origin/trunk", "HEAD");
  assert.equal(resolveDefaultBranch(f.cwd, () => "trunk"), "origin/trunk");
});

test("Uses a local default branch when no remote-tracking ref is available", (t) => {
  const f = fixture(t);
  const branch = f.git("branch", "--show-current").trim();
  assert.equal(resolveDefaultBranch(f.cwd, () => branch), branch);
});

test("Fails explicitly when GitHub's default branch is not fetched", (t) => {
  const f = fixture(t);
  assert.throws(() => resolveDefaultBranch(f.cwd, () => "unfetched"), /not available locally/);
});

function commit(f, path, content) {
  writeFileSync(join(f.cwd, path), content);
  f.git("add", path);
  f.git("commit", "--quiet", "-m", content.trim());
  return f.git("rev-parse", "HEAD").trim();
}

function publish(f) {
  f.git("update-ref", "refs/remotes/origin/main", "HEAD");
  f.git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
}

test("A merged branch keeps its original diff and commits as the default branch advances", (t) => {
  const f = fixture(t);
  const defaultBranch = f.git("branch", "--show-current").trim();
  const originalBase = f.git("rev-parse", "HEAD").trim();
  f.git("checkout", "--quiet", "-b", "feature");
  const first = commit(f, "feature.txt", "first\n");
  const head = commit(f, "feature.txt", "second\n");
  f.git("checkout", "--quiet", defaultBranch);
  const baseAtMerge = commit(f, "upstream.txt", "upstream\n");
  f.git("merge", "--quiet", "--no-ff", "--no-edit", "feature");
  f.git("checkout", "--quiet", "-b", "other");
  commit(f, "other.txt", "other\n");
  f.git("checkout", "--quiet", defaultBranch);
  f.git("merge", "--quiet", "--no-ff", "--no-edit", "other");
  commit(f, "later.txt", "later\n");
  publish(f);
  f.git("checkout", "--quiet", "feature");

  assert.equal(analyzeLocal({ cwd: f.cwd, base: "origin/main" }).commits.length, 0);
  const base = resolveReviewBase(f.cwd);
  assert.equal(base, baseAtMerge);
  const report = analyzeLocal({ cwd: f.cwd, base, includeWorking: true });
  assert.equal(report.comparison.mergeBaseSha, originalBase);
  assert.deepEqual(report.commits.map((entry) => entry.sha), [first, head]);
  assert.deepEqual(report.metrics.fileMetrics.map((file) => file.path), ["feature.txt"]);
  assert.match(getLocalFileDiff({ cwd: f.cwd, report, scope: "commit:1", path: "feature.txt" }).diff,
    /-first\n\+second/);
});

test("Explicit, unmerged, and already-contained checkouts keep the requested or default base", (t) => {
  const f = fixture(t);
  const defaultBranch = f.git("branch", "--show-current").trim();
  publish(f);
  assert.equal(resolveReviewBase(f.cwd, { base: "HEAD~1" }), "HEAD~1");
  assert.equal(resolveReviewBase(f.cwd), "origin/main");

  f.git("checkout", "--quiet", "-b", "stale");
  f.git("checkout", "--quiet", defaultBranch);
  commit(f, "advanced.txt", "advanced\n");
  publish(f);
  f.git("checkout", "--quiet", "stale");
  assert.equal(resolveReviewBase(f.cwd), "origin/main");

  f.git("checkout", "--quiet", "-b", "feature");
  commit(f, "feature.txt", "feature\n");
  assert.equal(resolveReviewBase(f.cwd), "origin/main");
});
