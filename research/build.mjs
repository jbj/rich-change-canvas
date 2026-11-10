import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { measure } from "./metrics.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const corpus = JSON.parse(readFileSync(join(root, "corpus.json"), "utf8"));
const pythonProbe = JSON.parse(readFileSync(join(root, "python-probe.json"), "utf8"));
assert.equal(corpus.samples.length, 30, "The expanded study must contain 30 PRs");
assert.equal(new Set(corpus.samples.map((sample) => sample.repository)).size, 30);
assert.ok(new Set(corpus.samples.map((sample) => sample.language)).size >= 5);
const samples = corpus.samples.map((sample) => {
  assert.ok(sample.mergedAt);
  assert.ok(sample.evidence.humanDiscussionEntries <= 2);
  assert.ok(sample.evidence.headHumanApprovals >= 1);
  assert.ok(sample.evidence.maintainerApprovals >= 1);
  assert.ok(sample.evidence.reviewEvents.some((review) =>
    review.state === "APPROVED" && review.human && !review.authorReview &&
    review.commitSha === sample.headSha && review.submittedAt <= sample.mergedAt));
  const metrics = measure(sample.files);
  assert.equal(metrics.additions, sample.additions);
  assert.equal(metrics.deletions, sample.deletions);
  const commits = sample.commits.map((commit) => {
    const result = measure(commit.files);
    assert.equal(result.additions, commit.additions);
    assert.equal(result.deletions, commit.deletions);
    return { ...commit, metrics: result };
  });
  return {
    ...sample, metrics, commits,
    historicalChurn: commits.reduce((sum, commit) => sum + commit.metrics.churn, 0),
    ordinaryCommitChurn: commits.filter((commit) => commit.parentCount < 2)
      .reduce((sum, commit) => sum + commit.metrics.churn, 0),
    mergeCommitChurn: commits.filter((commit) => commit.parentCount > 1)
      .reduce((sum, commit) => sum + commit.metrics.churn, 0),
    mergeCommits: commits.filter((commit) => commit.parentCount > 1).length,
    historicalFiles: new Set(commits.flatMap((commit) => commit.files.map((file) => file.path))).size,
  };
});

const summary = {
  projects: samples.length,
  languages: Object.fromEntries([...new Set(samples.map((sample) => sample.language))]
    .map((language) => [language, samples.filter((sample) => sample.language === language).length])),
  observedSourceLanguages: [...new Set(samples.flatMap((sample) => sample.metrics.fileMetrics
    .filter((file) => file.category === "source" && file.language).map((file) => file.language)))].sort(),
  files: samples.reduce((sum, sample) => sum + sample.files.length, 0),
  commits: samples.reduce((sum, sample) => sum + sample.commits.length, 0),
  multiCommitPRs: samples.filter((sample) => sample.commits.length > 1).length,
  mergeCommits: samples.reduce((sum, sample) => sum + sample.mergeCommits, 0),
  humanDiscussionEntries: samples.reduce((sum, sample) => sum + sample.evidence.humanDiscussionEntries, 0),
  automatedEntries: samples.reduce((sum, sample) => sum +
    sample.evidence.discussionEntries - sample.evidence.humanDiscussionEntries, 0),
  sourceWithoutSeparateTestDelta: samples.filter((sample) =>
    sample.metrics.sourceChurn > 0 && sample.metrics.supportChurn === 0).map((sample) => sample.url),
  incompletePRFiles: samples.flatMap((sample) => sample.metrics.fileMetrics
    .filter((file) => file.patchState === "missing-or-truncated")
    .map((file) => ({ pr: sample.url, path: file.path, additions: file.additions, deletions: file.deletions }))),
  incompleteCommitFiles: samples.flatMap((sample) => sample.commits.flatMap((commit) =>
    commit.metrics.fileMetrics.filter((file) => file.patchState === "missing-or-truncated")
      .map((file) => ({ pr: sample.url, commit: commit.sha, path: file.path })))),
  binaryPRFiles: samples.flatMap((sample) => sample.metrics.fileMetrics
    .filter((file) => file.binary).map((file) => ({ pr: sample.url, ...file }))),
  binaryCommitFiles: samples.flatMap((sample) => sample.commits.flatMap((commit) =>
    commit.metrics.fileMetrics.filter((file) => file.binary)
      .map((file) => ({ pr: sample.url, commit: commit.sha, ...file })))),
  unknownRoles: samples.flatMap((sample) => sample.metrics.fileMetrics
    .filter((file) => file.category === "other").map((file) => ({ pr: sample.url, path: file.path }))),
  distinctHistory: samples.filter((sample) => sample.historicalChurn !== sample.metrics.churn)
    .map((sample) => ({ pr: sample.url, netPRChurn: sample.metrics.churn,
      sumCommitChurn: sample.historicalChurn, commits: sample.commits.length })),
  largestSourceChanges: [...samples].sort((a, b) => b.metrics.sourceChurn - a.metrics.sourceChurn)
    .slice(0, 5).map((sample) => ({ pr: sample.url, lines: sample.metrics.sourceChurn,
      files: sample.metrics.categories.source?.files ?? 0 })),
};
const study = { schemaVersion: 1, selection: corpus.selection, summary, pythonProbe, samples };
writeFileSync(join(root, "results.json"), `${JSON.stringify(study, null, 2)}\n`);
writeFileSync(join(root, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
const template = readFileSync(join(root, "preview.template.html"), "utf8");
writeFileSync(join(root, "preview.html"), template.replace(
  "__STUDY_DATA__", JSON.stringify(study).replaceAll("<", "\\u003c"),
));
const group = (sample, category) => {
  const keys = category === "test" ? ["test", "test-support"] : [category];
  const metrics = keys.map((key) => sample.metrics.categories[key]).filter(Boolean);
  return metrics.length ? `+${metrics.reduce((sum, metric) => sum + metric.additions, 0)} / -${metrics.reduce((sum, metric) => sum + metric.deletions, 0)}` : "0";
};
writeFileSync(join(root, "report.md"), `# Low-discussion merged PR study

${corpus.selection}

This is a convenience sample, not a random sample or a validated approval
classifier. Every sample has recorded non-author human approval on its head
commit and a current maintainer approval. Human means GitHub account type is
not Bot; unmarked automation can remain in that count. Review quality, off-platform
discussion, and correctness are not established by these observations.

## Corpus

${summary.projects} projects, ${Object.keys(summary.languages).length} languages,
${summary.files} net-PR changed files, ${summary.commits} commits.
${summary.multiCommitPRs} PRs have more than one commit.
${summary.humanDiscussionEntries} human discussion entries and
${summary.automatedEntries} automated entries are recorded separately.

Language labels identify sampling cohorts, not every file's language. Changed
production source actually includes: ${summary.observedSourceLanguages.join(", ")}.
The analyzer selects language by file, not by project name; for example, the
TypeScript-project sample also changes Go code.

| PR | Language cohort | Human entries | Head approvals | Commits | Source lines | Test/support lines | Fixture lines | Snapshot lines | Other total lines |
|---|---|---:|---:|---:|---|---|---|---|---:|
${samples.map((sample) => `| [${sample.repository}#${sample.number}](${sample.url}) | ${sample.language} | ${sample.evidence.humanDiscussionEntries} | ${sample.evidence.headHumanApprovals} | ${sample.commits.length} | ${group(sample, "source")} | ${group(sample, "test")} | ${group(sample, "fixture")} | ${group(sample, "snapshot")} | ${sample.metrics.churn - sample.metrics.sourceChurn - sample.metrics.supportChurn} |`).join("\n")}

## What this tests, and what it does not

- File-role summaries apply across all six languages without pretending to parse
  their semantic structure. Role reasons remain inspectable.
- ${summary.sourceWithoutSeparateTestDelta.length} PRs contain recognized source
  changes without separate test/fixture/snapshot line changes. That is not proof
  of absent tests: Rust and other languages often keep tests inside source files.
  Using this as a mandatory manual-review rule would flag accepted examples.
- ${summary.distinctHistory.length} PRs have different net-PR churn and summed
  individual-commit churn. Commit-level inspection must not substitute summed
  history for the final base/head diff.
- There are ${summary.mergeCommits} merge commits in the sampled PR histories.
  Elasticsearch #165122 has only 14 final changed lines, but its upstream merge
  contributes 25,093 first-parent changed lines. Distinguish merge context from
  ordinary commits, without hiding conflict resolutions inside merges.
- Tokio #8750 adds an inline Rust test inside the same source file. The
  file-level "no separate test delta" observation is literally true but cannot
  support an absence-of-tests claim. The prototype exposes added Rust
  test-attribute patch lines as lexical evidence, not tests run or coverage.
- Kafka #24140 changes Java test-support code in src/testFixtures. The first
  classifier counted it as production source. The refined rule and regression
  test put it in test support. Babel output.json and TypeScript reference
  baselines are separated from test inputs as snapshots.
- ${summary.binaryPRFiles.length} binary files occur in net PR diffs;
  ${summary.binaryCommitFiles.length} occur in individual commit diffs. Display
  before/after bytes for these files, not zero lines as a size claim.
  If this count is zero, binary behavior has only unit-fixture validation in
  this study, not real-corpus validation. Attempts to enrich the study with a
  binary case did not meet the same review criteria; those cases were not
  smuggled into the accepted corpus.
- ${summary.incompletePRFiles.length} incomplete textual patches occur in net
  PR diffs; ${summary.incompleteCommitFiles.length} in commit diffs. Counts from
  GitHub metadata remain available even when patch-derived analysis is not.
- ${summary.unknownRoles.length} files have no explicit role match. They remain
  visible as other, not silently counted as source.
- Only positive low-discussion examples were requested. This corpus can expose
  false alarms from proposed cues, but cannot measure contentious-PR recall,
  approval safety, false-negative rates, or human time saved.

## Structural probe, not just file statistics

The standard-library Python AST parser was applied to the largest modified
production Python file in each Python PR, not the complete PR or its individual
commits. A documented per-function decision-count variant excludes nested
function bodies from their parents. No changed code was executed.

- Django #22257 changes a docstring inside a source file. Executable AST
  structure is identical after removing leading docstring expressions;
  parse_time remains 6 -> 6. This is not a behavior-equivalence guarantee:
  Python docstrings remain observable through __doc__.
- Pandas #71957 is a performance change but its changed function remains
  4 -> 4. Decision counts do not measure runtime efficiency.
- Pytest #15361 is a bug fix but its changed function also remains 4 -> 4.
  Decision counts do not establish correctness.
- Flask #5818 changes dispatch/context structure. The probe sees added helper
  functions and an existing function changing 6 -> 5. Show a declaration
  inventory plus local deltas, not an unexplained summed quality score.
- Pandas contains repeated function names used for overload declarations. The
  first identity strategy failed on these. The probe preserves occurrences and
  refuses pairwise matching when definition counts differ.

Pinned multilingual Tree-sitter parser acquisition was attempted twice through
CFS, but Azure CLI token acquisition failed. No packages were installed and no
six-language semantic-analysis result is claimed. The Python probe uses only
the installed standard library. Other languages retain honest file-level
measurements until parser acquisition is available.

## Definitions and limitations

Line counts are added/deleted text lines, including comments and blanks, not
logical statements. Role heuristics are versioned in metrics.mjs. A file belongs
to one display category in this study; nested/inline test code is not separated.
Net PR diffs compare merge-base with head; each commit compares with its first
parent. A merge commit is explicitly marked and may include upstream changes.
GitHub lists at most 250 PR commits; such oversized histories are excluded with
a recorded selection reason. No repository code, build, or workflow is executed.
Raw responses stay in the session cache, not the shareable compact dataset.

## Reproduce

Run \`STUDY_CACHE=/absolute/path/outside/repo node collect.mjs\` to acquire public
data with authenticated gh. Run \`node --test metrics.test.mjs\`, then
\`node build.mjs\` to regenerate the prototype and this report from corpus.json.
Open preview.html directly in a browser. No packages or server are required.
`);
console.log(JSON.stringify(summary, null, 2));
