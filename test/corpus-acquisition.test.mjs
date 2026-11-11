import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { acquireCorpus } from "../src/corpus.mjs";
import { createGithubCache } from "../src/github-cache.mjs";
import { loadReport } from "../src/report.mjs";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "rich-corpus-acquisition-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const corpus = JSON.parse(await readFile(new URL("../research/corpus.json", import.meta.url), "utf8"));
  const sample = corpus.samples[0];
  corpus.samples = [sample];
  const contents = {
    "main.go": ["package main\n// old\n", "package main\n\n// new\nif ready {}  \n"],
    "empty.go": [null, ""],
    "removed.go": ["// no final newline", null],
    "renamed.go": ["package main\n", "package main\n"],
    "asset.bin": [Buffer.from([0, 1]), Buffer.from([0, 2, 3])],
  };
  const files = Object.keys(contents).map((path) => ({
    path, previousPath: path === "renamed.go" ? "old.go" : null,
    status: path === "empty.go" ? "added" : path === "removed.go" ? "removed" :
      path === "renamed.go" ? "renamed" : "modified",
    additions: path === "main.go" ? 3 : 0, deletions: path === "main.go" || path === "removed.go" ? 1 : 0,
    binary: path === "asset.bin", patchState: path === "asset.bin" ? "binary" : "complete",
    beforeBytes: path === "asset.bin" ? 2 : null, afterBytes: path === "asset.bin" ? 3 : null,
    addedRustTestAttributes: 0, removedRustTestAttributes: 0,
  }));
  Object.assign(sample, { files, additions: 3, deletions: 2,
    commits: [{ sha: sample.headSha, parentSha: sample.mergeBaseSha, parentCount: 1,
      subject: "Fixture change", url: `https://github.com/${sample.repository}/commit/${sample.headSha}`,
      files, additions: 3, deletions: 2 }] });
  let requests = 0;
  const api = createGithubCache({
    directory: join(directory, ".cache", "rich-change-canvas", "github-v1"),
    authenticate: async () => {},
    request: async (endpoint) => {
      requests++;
      const url = new URL(`https://api.github.com/${endpoint}`);
      const path = decodeURIComponent(url.pathname.split("/contents/")[1]);
      const bytes = Buffer.from(contents[path === "old.go" ? "renamed.go" : path][
        url.searchParams.get("ref") === sample.headSha ? 1 : 0]);
      return { type: "file", size: bytes.length, encoding: "base64", content: bytes.toString("base64") };
    },
  });
  return { directory, corpus, api, requests: () => requests };
}

test("Corpus hydrates exact retained revisions, computes metrics and embeds complete diffs in every scope", async (t) => {
  const f = await fixture(t);
  const [report] = await acquireCorpus(f.corpus, { api: f.api });
  assert.equal(f.requests(), 8);
  assert.equal(report.metrics.incomplete, 0);
  assert.equal(report.metrics.binaryFiles, 1);
  const main = report.metrics.fileMetrics.find((file) => file.path === "main.go");
  assert.equal(main.alternativeMetrics["blank-lines"].changes.additions.value, 1);
  assert.equal(main.alternativeMetrics["trailing-whitespace"].changes.additions.value, 1);
  assert.equal(main.alternativeMetrics["decision-keywords"].changes.additions.value, 1);
  assert.match(main.diff.diff, /\+if ready \{\}  /);
  assert.match(report.metrics.fileMetrics.find((file) => file.path === "removed.go").diff.diff, /No newline at end of file/);
  assert.equal(report.metrics.fileMetrics.find((file) => file.path === "empty.go").diff.diff, "");
  assert.equal(report.metrics.fileMetrics.find((file) => file.path === "renamed.go").patchState, "rename-only");
  assert.deepEqual(report.commits[0].metrics, report.metrics);
  assert.deepEqual(report.source.reviewEvidence, f.corpus.samples[0].evidence);
  assert.doesNotMatch(report.warnings.join(" "), /not reverified|not embedded/);
});

test("Corpus CLI replays cached acquisition with no gh calls, persists all evidence and reopens offline", async (t) => {
  const f = await fixture(t);
  const expected = await acquireCorpus(f.corpus, { api: f.api });
  const input = join(f.directory, "corpus.json"), output = join(f.directory, "out");
  await writeFile(input, JSON.stringify(f.corpus));
  const bin = join(f.directory, "bin");
  await mkdir(bin);
  await writeFile(join(bin, "gh"), "#!/bin/sh\necho 'Unexpected GitHub request' >&2\nexit 99\n", { mode: 0o700 });
  const env = { ...process.env, HOME: f.directory, PATH: `${bin}:${process.env.PATH}` };
  execFileSync(process.execPath, [resolve("cli.mjs"), "corpus", "--input", input, "--out", output], { env });
  assert.deepEqual(await loadReport(output, expected[0].id), expected[0]);
  const html = await readFile(join(output, "review.html"), "utf8");
  const embedded = JSON.parse(html.match(/<script id="report-data"[^>]*>([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(embedded, expected);
  execFileSync(process.execPath, [resolve("cli.mjs"), "view", "--input", join(output, `${expected[0].id}.json`),
    "--out", join(f.directory, "reopened")], { env });
  assert.ok((await readdir(join(f.directory, "reopened"))).includes("review.html"));
});

test("Retained line counts that disagree with reconstructed source fail explicitly", async (t) => {
  const f = await fixture(t);
  f.corpus.samples[0].files[0].additions++;
  f.corpus.samples[0].additions++;
  f.corpus.samples[0].commits[0].additions++;
  await assert.rejects(acquireCorpus(f.corpus, { api: f.api }), /Incomplete changed-line evidence/);
});
