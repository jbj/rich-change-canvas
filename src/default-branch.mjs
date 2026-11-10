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
