import { run } from "./process.mjs";

function referenceExists(cwd, ref) {
  return run("git", ["for-each-ref", "--format=%(refname)", ref], { cwd }).trim() === ref;
}

export function resolveDefaultBranch(cwd, lookupDefaultBranch = () =>
  run("gh", ["repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"], { cwd }).trim()) {
  const originHead = run("git", [
    "for-each-ref", "--format=%(symref)", "refs/remotes/origin/HEAD",
  ], { cwd }).trim();
  const match = /^refs\/remotes\/origin\/(.+)$/.exec(originHead);
  if (match) {
    const ref = `refs/remotes/origin/${match[1]}`;
    if (referenceExists(cwd, ref)) return `origin/${match[1]}`;
  }

  const branch = lookupDefaultBranch();
  if (!branch || branch === "null" || /[\r\n\0]/.test(branch)) {
    throw new Error("Unable to determine the repository's default branch");
  }
  const remoteRef = `refs/remotes/origin/${branch}`;
  if (referenceExists(cwd, remoteRef)) return `origin/${branch}`;
  const localRef = `refs/heads/${branch}`;
  if (referenceExists(cwd, localRef)) return branch;
  throw new Error(`Default branch "${branch}" is not available locally. Fetch it before opening the canvas.`);
}

function isAncestor(cwd, ancestor, descendant) {
  return run("git", ["rev-list", "--count", `${descendant}..${ancestor}`], { cwd }).trim() === "0";
}

// Once HEAD has been merged, merge-base(default, HEAD) is HEAD itself and the
// diff is empty. The oldest first-parent commit on the default branch that
// contains HEAD is the commit that merged it; its first parent is the default
// branch as it was at merge time, recorded immutably in local history.
export function resolveReviewBase(cwd, { base, lookupDefaultBranch } = {}) {
  if (base !== undefined) return base;
  const defaultBranch = resolveDefaultBranch(cwd, lookupDefaultBranch);
  const head = run("git", ["rev-parse", "--verify", "HEAD^{commit}"], { cwd }).trim();
  if (!isAncestor(cwd, head, defaultBranch)) return defaultBranch;
  const [mergeCommit] = run("git", [
    "rev-list", "--first-parent", "--ancestry-path", "--reverse", `${head}..${defaultBranch}`,
  ], { cwd }).split("\n").filter(Boolean);
  if (!mergeCommit) return defaultBranch;
  const [, firstParent, ...otherParents] = run("git", ["rev-list", "--parents", "-n", "1", mergeCommit], { cwd })
    .trim().split(" ");
  if (!firstParent || !otherParents.length || isAncestor(cwd, head, firstParent)) return defaultBranch;
  return firstParent;
}
