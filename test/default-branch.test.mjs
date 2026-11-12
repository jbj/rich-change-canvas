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

for (const strategy of ["merge", "squash", "rebase"]) {
  test(`Merged PR keeps its original diff and commits after ${strategy} merging and base advancement`, (t) => {
    const f = fixture(t);
    const defaultBranch = f.git("branch", "--show-current").trim();
    const originalBase = f.git("rev-parse", "HEAD").trim();
    f.git("checkout", "--quiet", "-b", "feature");
    const commit = (path, content) => {
      writeFileSync(join(f.cwd, path), content);
      f.git("add", path);
      f.git("commit", "--quiet", "-m", content.trim());
      return f.git("rev-parse", "HEAD").trim();
    };
    const first = commit("feature.txt", "first\n");
    const head = commit("feature.txt", "second\n");
    f.git("checkout", "--quiet", defaultBranch);
    const baseRefOid = commit("upstream.txt", "upstream\n");
    if (strategy === "merge") f.git("merge", "--no-ff", "--no-edit", "feature");
    else if (strategy === "squash") {
      f.git("merge", "--squash", "feature");
      f.git("commit", "--quiet", "-m", "squashed");
    } else {
      f.git("cherry-pick", first, head);
    }
    commit("later.txt", "later\n");
    f.git("update-ref", "refs/remotes/origin/main", "HEAD");
    f.git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
    f.git("checkout", "--quiet", "feature");
    const base = resolveReviewBase(f.cwd, { lookupMergedPullRequests: (branch) => {
      assert.equal(branch, "feature");
      return [{ headRefOid: head, baseRefOid }];
    } });
    assert.equal(base, baseRefOid);
    const report = analyzeLocal({ cwd: f.cwd, base, includeWorking: true });
    assert.equal(report.comparison.mergeBaseSha, originalBase);
    assert.equal(report.comparison.headSha, head);
    assert.deepEqual(report.commits.map((entry) => entry.sha), [first, head]);
    assert.deepEqual(report.metrics.fileMetrics.map((file) => file.path), ["feature.txt"]);
    assert.match(getLocalFileDiff({ cwd: f.cwd, report, scope: "whole", path: "feature.txt" }).diff, /\+second/);
    assert.match(getLocalFileDiff({ cwd: f.cwd, report, scope: "commit:1", path: "feature.txt" }).diff, /-first\n\+second/);
    writeFileSync(join(f.cwd, "feature.txt"), "staged\n");
    f.git("add", "feature.txt");
    const mutable = analyzeLocal({ cwd: f.cwd, base, includeWorking: true });
    assert.match(getLocalFileDiff({ cwd: f.cwd, report: mutable, scope: "index", path: "feature.txt" }).diff,
      /-second\n\+staged/);
  });
}

test("Explicit bases, default branches, and detached checkouts do not query merged PRs", (t) => {
  const f = fixture(t);
  const lookupMergedPullRequests = () => assert.fail("Should not query merged PRs");
  assert.equal(resolveReviewBase(f.cwd, { base: "HEAD~1", lookupMergedPullRequests }), "HEAD~1");
  const branch = f.git("branch", "--show-current").trim();
  assert.equal(resolveReviewBase(f.cwd, {
    lookupDefaultBranch: () => branch, lookupMergedPullRequests,
  }), branch);
  f.git("checkout", "--quiet", "--detach");
  assert.equal(resolveReviewBase(f.cwd, {
    lookupDefaultBranch: () => branch, lookupMergedPullRequests,
  }), branch);
});

test("Unmerged branches and branches with post-merge commits keep the default base", (t) => {
  const f = fixture(t);
  const branch = f.git("branch", "--show-current").trim();
  const oldHead = f.git("rev-parse", "HEAD").trim();
  f.git("checkout", "--quiet", "-b", "feature");
  writeFileSync(join(f.cwd, "next.txt"), "next\n");
  f.git("add", "next.txt");
  f.git("commit", "--quiet", "-m", "next");
  for (const prs of [[], [{ headRefOid: oldHead, baseRefOid: oldHead }]]) {
    assert.equal(resolveReviewBase(f.cwd, {
      lookupDefaultBranch: () => branch, lookupMergedPullRequests: () => prs,
    }), branch);
  }
});

test("Missing merged-PR history and lookup failures are reported explicitly", (t) => {
  const f = fixture(t);
  const branch = f.git("branch", "--show-current").trim();
  const headRefOid = f.git("rev-parse", "HEAD").trim();
  f.git("checkout", "--quiet", "-b", "feature");
  const options = { lookupDefaultBranch: () => branch };
  assert.throws(() => resolveReviewBase(f.cwd, {
    ...options, lookupMergedPullRequests: () => [{ headRefOid, baseRefOid: "f".repeat(40) }],
  }), /not available locally/);
  assert.throws(() => resolveReviewBase(f.cwd, {
    ...options, lookupMergedPullRequests: () => [{ headRefOid, baseRefOid: null }],
  }), /no recorded base/);
  assert.throws(() => resolveReviewBase(f.cwd, {
    ...options, lookupMergedPullRequests: () => { throw new Error("GitHub authentication failed"); },
  }), /GitHub authentication failed/);
});
