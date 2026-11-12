import { createReport } from "./report.mjs";
import { createGithubCache } from "./github-cache.mjs";
import { createGithubFiles } from "./github-files.mjs";

export async function acquireCorpus(corpus, { api = createGithubCache(), syntaxAnalyzer } = {}) {
  const retained = reportsFromCorpus(corpus);
  return Promise.all(retained.map(async (report, index) => {
    const sample = corpus.samples[index];
    const collect = createGithubFiles({ repository: sample.repository, api, syntaxAnalyzer });
    const [files, commits] = await Promise.all([
      collect(sample.files, sample.mergeBaseSha, sample.headSha),
      Promise.all(sample.commits.map(async (commit) => ({
        ...commit, files: await collect(commit.files, commit.parentSha, commit.sha),
      }))),
    ]);
    return createReport({
      source: report.source, title: report.title, comparison: report.comparison, files, commits,
      warnings: [
        `Retained study snapshot collected ${sample.collectedAt}; source and diffs acquired at the recorded immutable revisions.`,
        `Convenience sample selection: ${corpus.selection}`,
        "File roles are path heuristics. Test-line changes are not coverage or evidence of correctness.",
        "Each commit is compared with its first parent; merge context can contain upstream changes absent from the final PR.",
      ],
    });
  }));
}

export function reportsFromCorpus(corpus) {
  const require = (condition, message) => {
    if (!condition) throw new Error(`Invalid corpus: ${message}`);
  };
  const text = (value) => typeof value === "string" && value.trim().length > 0;
  const count = (value) => Number.isSafeInteger(value) && value >= 0;
  const sha = (value) => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
  const timestamp = (value) => text(value) && Number.isFinite(Date.parse(value));
  require(corpus?.schemaVersion === 1, "unsupported schemaVersion");
  require(text(corpus.selection), "selection description is required");
  require(Array.isArray(corpus.samples) && corpus.samples.length > 0, "samples must be a non-empty array");
  const identities = new Set();
  function validateScope(scope, label) {
    require(Array.isArray(scope.files), `${label}: files must be an array`);
    const paths = new Set();
    for (const file of scope.files) {
      require(file && text(file.path) && !paths.has(file.path), `${label}: missing or duplicate file path`);
      paths.add(file.path);
      require(["added", "removed", "modified", "renamed", "copied", "changed", "unchanged"].includes(file.status),
        `${label}: invalid file status`);
      require(file.previousPath === null || text(file.previousPath), `${label}: invalid previousPath`);
      require(file.status !== "renamed" || text(file.previousPath), `${label}: rename requires previousPath`);
      require(count(file.additions) && count(file.deletions), `${label}: invalid file line counts`);
      require(typeof file.binary === "boolean", `${label}: binary must be boolean`);
      require(["complete", "missing-or-truncated", "rename-only", "binary"].includes(file.patchState),
        `${label}: invalid patchState`);
      require(file.binary === (file.patchState === "binary"), `${label}: inconsistent binary patch state`);
      require(!file.binary || file.additions + file.deletions === 0, `${label}: binary files cannot have text lines`);
      for (const field of ["beforeBytes", "afterBytes"]) {
        require(file[field] === null || count(file[field]), `${label}: invalid ${field}`);
      }
      for (const field of ["addedRustTestAttributes", "removedRustTestAttributes"]) {
        require(count(file[field]), `${label}: invalid ${field}`);
      }
    }
    for (const field of ["additions", "deletions"]) {
      require(count(scope[field]) && scope.files.reduce((sum, file) => sum + file[field], 0) === scope[field],
        `${label}: ${field} totals do not reconcile`);
    }
  }
  const reports = corpus.samples.map((sample) => {
    require(sample && text(sample.repository) && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(sample.repository) &&
      !sample.repository.split("/").some((part) => part === "." || part === ".."), "invalid repository");
    const label = `${sample.repository}#${sample.number}`;
    require(count(sample.number) && sample.number > 0 && !identities.has(label), `${label}: invalid or duplicate PR number`);
    identities.add(label);
    require(text(sample.title) && text(sample.language), `${label}: title and language are required`);
    require(sample.url === `https://github.com/${sample.repository}/pull/${sample.number}`, `${label}: invalid PR URL`);
    require(timestamp(sample.mergedAt) && timestamp(sample.collectedAt), `${label}: invalid collection or merge timestamp`);
    for (const field of ["baseSha", "headSha", "mergeBaseSha", "mergeCommitSha"]) {
      require(sha(sample[field]), `${label}: invalid ${field}`);
    }
    validateScope(sample, label);
    require(Array.isArray(sample.commits) && sample.commits.length > 0, `${label}: commits must be a non-empty array`);
    const commits = new Set();
    for (const commit of sample.commits) {
      require(commit && sha(commit.sha) && !commits.has(commit.sha), `${label}: invalid or duplicate commit SHA`);
      commits.add(commit.sha);
      require(count(commit.parentCount) && (commit.parentCount === 0 ? commit.parentSha === null : sha(commit.parentSha)),
        `${label}: invalid commit parents`);
      require(text(commit.subject) && commit.url === `https://github.com/${sample.repository}/commit/${commit.sha}`,
        `${label}: invalid commit subject or URL`);
      validateScope(commit, `${label} commit ${commit.sha}`);
    }
    for (const field of ["issueComments", "inlineComments", "humanDiscussionEntries", "headHumanApprovals", "maintainerApprovals"]) {
      require(count(sample.evidence?.[field]), `${label}: invalid review evidence ${field}`);
    }
    return {
      source: {
        kind: "corpus", repository: sample.repository, number: sample.number, url: sample.url,
        state: "merged", mergedAt: sample.mergedAt, collectedAt: sample.collectedAt,
        language: sample.language, selection: corpus.selection, reviewEvidence: sample.evidence,
        discussion: {
          issueComments: sample.evidence.issueComments, inlineComments: sample.evidence.inlineComments,
          note: `Retained study evidence: ${sample.evidence.humanDiscussionEntries} human discussion entries; ` +
            `${sample.evidence.headHumanApprovals} non-author human head approvals; ` +
            `${sample.evidence.maintainerApprovals} maintainer approvals. Raw comment totals above include bots. ` +
            "These observations do not establish review quality or correctness.",
        },
      },
      title: `#${sample.number} ${sample.title}`,
      comparison: { baseSha: sample.baseSha, mergeBaseSha: sample.mergeBaseSha,
        headSha: sample.headSha, mergeCommitSha: sample.mergeCommitSha },
      files: sample.files, commits: sample.commits,
      warnings: [
        `Offline study snapshot collected ${sample.collectedAt}; language cohort: ${sample.language}. Not refreshed from GitHub.`,
        `Convenience sample selection: ${corpus.selection}`,
        "Patches and source are not embedded. Patch states and lexical counts are retained collection evidence, not reverified during import.",
        "File roles are path heuristics. Test-line changes are not coverage or evidence of correctness.",
        "Each commit is compared with its first parent; merge context can contain upstream changes absent from the final PR.",
      ],
    };
  });
  if (reports.every((report) => !report.files.some((file) => file.binary) &&
      report.commits.every((commit) => !commit.files.some((file) => file.binary)))) {
    for (const report of reports) {
      report.warnings.push("This corpus contains no binary changes; it does not demonstrate binary rendering on real PRs.");
    }
  }
  return reports.map(createReport);
}
