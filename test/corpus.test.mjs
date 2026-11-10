import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { reportsFromCorpus } from "../src/corpus.mjs";
import { digest } from "../src/report.mjs";

const corpus = JSON.parse(readFileSync(new URL("../research/corpus.json", import.meta.url), "utf8"));

test("Offline corpus import preserves every final footprint, commit and evidence record", () => {
  const before = JSON.stringify(corpus);
  const reports = reportsFromCorpus(corpus);
  assert.equal(reports.length, 30);
  assert.equal(new Set(reports.map((report) => report.source.language)).size, 6);
  assert.equal(reports.reduce((sum, report) => sum + report.metrics.files, 0), 1011);
  const commits = reports.flatMap((report) => report.commits);
  assert.equal(commits.length, 61);
  assert.equal(commits.filter((commit) => commit.parentCount > 1).length, 5);
  assert.equal(commits.reduce((sum, commit) => sum + commit.metrics.incomplete, 0), 1);
  for (const [index, report] of reports.entries()) {
    const sample = corpus.samples[index];
    assert.equal(report.source.url, sample.url);
    assert.equal(report.source.collectedAt, sample.collectedAt);
    assert.deepEqual(report.source.reviewEvidence, sample.evidence);
    assert.equal(report.comparison.mergeBaseSha, sample.mergeBaseSha);
    assert.equal(report.comparison.headSha, sample.headSha);
    assert.equal(report.comparison.mergeCommitSha, sample.mergeCommitSha);
    assert.equal(report.metrics.files, sample.files.length);
    assert.equal(report.metrics.additions, sample.additions);
    assert.equal(report.metrics.deletions, sample.deletions);
    for (const [i, commit] of report.commits.entries()) {
      const original = sample.commits[i];
      assert.deepEqual(commit.files, original.files);
      assert.equal(commit.sha, original.sha);
      assert.equal(commit.parentSha, original.parentSha);
      assert.equal(commit.parentCount, original.parentCount);
      assert.equal(commit.url, original.url);
      assert.equal(commit.metrics.additions, original.additions);
      assert.equal(commit.metrics.deletions, original.deletions);
    }
    const { id, ...content } = report;
    assert.equal(id, digest(JSON.stringify(content)));
    assert.match(report.warnings.join(" "), /not reverified/);
    assert.match(report.warnings.join(" "), /no binary changes/);
    assert.equal(report.structuralAnalysis.status, "unavailable");
  }
  assert.equal(JSON.stringify(corpus), before);
});

test("Corpus import rejects malformed or inconsistent study data explicitly", () => {
  const mutations = [
    [(c) => { c.schemaVersion = 2; }, /schemaVersion/],
    [(c) => { c.samples = []; }, /non-empty array/],
    [(c) => { c.samples[0].additions++; }, /totals do not reconcile/],
    [(c) => { c.samples[0].commits[0].deletions++; }, /totals do not reconcile/],
    [(c) => { c.samples[0].headSha = "not-a-sha"; }, /headSha/],
    [(c) => { c.samples[0].files[0].patchState = "unknown"; }, /patchState/],
    [(c) => { c.samples[0].commits[0].parentSha = null; }, /commit parents/],
    [(c) => { c.samples[0].evidence = null; }, /review evidence/],
    [(c) => { c.samples.push(c.samples[0]); }, /duplicate PR/],
    [(c) => { c.samples[0].url = "javascript:alert(1)"; }, /PR URL/],
    [(c) => { c.samples[0].files[0].binary = true; }, /binary patch state/],
  ];
  assert.throws(() => reportsFromCorpus(null), /Invalid corpus/);
  for (const [mutate, error] of mutations) {
    const copy = structuredClone(corpus);
    mutate(copy);
    assert.throws(() => reportsFromCorpus(copy), error);
  }
});
