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

export function resolveReviewBase(cwd, { base, lookupDefaultBranch, lookupMergedPullRequests = (branch) =>
  JSON.parse(run("gh", ["pr", "list", "--state", "merged", "--head", branch,
    "--limit", "100", "--json", "headRefOid,baseRefOid"], { cwd })) } = {}) {
  if (base !== undefined) return base;
  const defaultBranch = resolveDefaultBranch(cwd, lookupDefaultBranch);
  const branch = run("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], {
    cwd, allowedExitCodes: [0, 1],
  }).trim();
  const defaultRef = run("git", ["rev-parse", "--symbolic-full-name", defaultBranch], { cwd }).trim();
  const defaultName = defaultRef.replace(/^refs\/(?:remotes\/origin|heads)\//, "");
  if (!branch || branch === defaultName) return defaultBranch;

  const headSha = run("git", ["rev-parse", "--verify", "HEAD"], { cwd }).trim();
  const merged = lookupMergedPullRequests(branch).find((pr) => pr.headRefOid === headSha);
  if (!merged) return defaultBranch;
  if (!/^[0-9a-f]{40,64}$/.test(merged.baseRefOid ?? "")) {
    throw new Error("Merged PR has no recorded base commit. Open the canvas with an explicit base.");
  }
  const available = run("git", ["rev-parse", "--verify", "--quiet", `${merged.baseRefOid}^{commit}`], {
    cwd, allowedExitCodes: [0, 1],
  }).trim();
  if (!available) {
    throw new Error(`Merged PR base commit "${merged.baseRefOid}" is not available locally. Fetch its history before opening the canvas.`);
  }
  return merged.baseRefOid;
}
