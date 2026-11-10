import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/process.mjs";
import { resolveDefaultBranch } from "../src/default-branch.mjs";

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
