import { createReport } from "./report.mjs";
import { createGithubCache } from "./github-cache.mjs";
import { createGithubFiles } from "./github-files.mjs";

export async function analyzePullRequest({ repository, number, maxCommits = 250,
  maxBlobBytes = 16 * 1024 * 1024, api = createGithubCache() } = {}) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "") ||
      repository.split("/").some((part) => part === "." || part === "..")) {
    throw new Error("Repository must be owner/name");
  }
  if (!Number.isSafeInteger(number) || number < 1) throw new Error("PR number must be a positive integer");
  const prefix = `repos/${repository}`;
  const prPath = `${prefix}/pulls/${number}`;
  const pr = await api(prPath);
  if (pr.commits > maxCommits || pr.commits > 250) {
    throw new Error(`PR has ${pr.commits} commits; supported limit is ${Math.min(maxCommits, 250)}`);
  }
  async function pages(endpoint, extract = (value) => value) {
    const records = [];
    for (let page = 1; page <= 31; page++) {
      const response = await api(`${endpoint}?per_page=100&page=${page}`);
      const items = extract(response);
      if (!Array.isArray(items)) throw new Error(`Expected paginated records: ${endpoint}`);
      records.push(...items);
      if (items.length < 100) return records;
    }
    throw new Error(`GitHub pagination limit reached: ${endpoint}`);
  }
  function reconcile(records, additions, deletions, label) {
    if (records.reduce((sum, file) => sum + file.additions, 0) !== additions ||
        records.reduce((sum, file) => sum + file.deletions, 0) !== deletions) {
      throw new Error(`Incomplete or stale ${label}: line totals do not reconcile`);
    }
  }
  const [comparison, rawFiles, rawCommits] = await Promise.all([
    api(`${prefix}/compare/${pr.base.sha}...${pr.head.sha}`),
    pages(`${prPath}/files`), pages(`${prPath}/commits`),
  ]);
  const mergeBaseSha = comparison.merge_base_commit.sha;
  if (rawFiles.length !== pr.changed_files) throw new Error("Incomplete PR file list");
  reconcile(rawFiles, pr.additions, pr.deletions, "PR");
  if (rawCommits.length !== pr.commits) throw new Error("Incomplete PR commit history");
  const files = createGithubFiles({ repository, api, maxBlobBytes });
  const [wholeFiles, commits] = await Promise.all([
    files(rawFiles, mergeBaseSha, pr.head.sha),
    Promise.all(rawCommits.map(async (entry) => {
      let metadata;
      const records = await pages(`${prefix}/commits/${entry.sha}`, (response) => {
        metadata ??= response;
        return response.files;
      });
      reconcile(records, metadata.stats.additions, metadata.stats.deletions, `commit ${entry.sha}`);
      const parentSha = metadata.parents[0]?.sha ?? null;
      return {
        sha: entry.sha, parentSha, parentCount: metadata.parents.length,
        subject: metadata.commit.message.split("\n")[0], url: metadata.html_url,
        files: await files(records, parentSha, entry.sha),
      };
    })),
  ]);
  const latest = await api(prPath);
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
      "GitHub acquisition is cached; remove ~/.cache/rich-change-canvas/github-v1 to refresh mutable PR metadata.",
      "File roles are path heuristics. Test-line changes are not coverage or evidence of correctness.",
      "Each commit is compared with its first parent; merge context can contain upstream changes absent from the final PR.",
    ],
  });
}
