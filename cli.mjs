#!/usr/bin/env node
import { parseArgs } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, join, relative, sep, isAbsolute } from "node:path";
import { analyzeLocal, getLocalFileDiff } from "./src/local.mjs";
import { analyzePullRequest } from "./src/github.mjs";
import { saveReport, loadReport, createReport } from "./src/report.mjs";
import { renderReports } from "./src/render.mjs";
import { acquireCorpus } from "./src/corpus.mjs";

const help = `Usage:
  node cli.mjs local --base <ref> --out <artifact-directory> [--cwd <repo>] [--working]
  node cli.mjs pr --repository <owner/name> --number <N> --out <artifact-directory>
  node cli.mjs view --input <report.json> [--input <report.json> ...] --out <artifact-directory>
  node cli.mjs corpus --input <corpus.json> --out <artifact-directory>

Reports are read-only snapshots. Output includes immutable JSON and review.html.
Local analysis never switches branches, stashes, commits, or executes repository code.
--working adds separate staged, unstaged, and untracked snapshots.
GitHub acquisition requires authenticated gh on cache misses.
API responses are cached under ~/.cache/rich-change-canvas; cached runs need no requests.
corpus computes all metrics at retained study revisions and embeds diffs for offline review.
`;

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      base: { type: "string" }, out: { type: "string" }, cwd: { type: "string" },
      working: { type: "boolean", default: false }, repository: { type: "string" },
      number: { type: "string" }, input: { type: "string", multiple: true },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(help);
  } else {
    const [command] = positionals;
    if (positionals.length !== 1 || !["local", "pr", "view", "corpus"].includes(command)) throw new Error(help);
    if (!values.out) throw new Error("--out is required; choose an artifact directory outside the analyzed repository");
    const allowed = {
      local: new Set(["base", "out", "cwd", "working"]),
      pr: new Set(["repository", "number", "out"]),
      view: new Set(["input", "out"]),
      corpus: new Set(["input", "out"]),
    }[command];
    for (const [key, value] of Object.entries(values)) {
      if (value !== false && !allowed.has(key)) throw new Error(`--${key} is not valid for ${command}`);
    }
    const output = resolve(values.out);
    let reports;
    if (command === "local") reports = [analyzeLocal({ cwd: values.cwd, base: values.base, includeWorking: values.working })];
    if (command === "pr") reports = [await analyzePullRequest({ repository: values.repository, number: Number(values.number) })];
    if (command === "corpus") {
      if (values.input?.length !== 1) throw new Error("corpus requires exactly one --input corpus.json");
      reports = await acquireCorpus(JSON.parse(await readFile(resolve(values.input[0]), "utf8")));
    }
    if (command === "view") {
      if (!values.input?.length) throw new Error("view requires at least one --input report.json");
      reports = await Promise.all(values.input.map(async (path) => {
        const absolute = resolve(path);
        const content = JSON.parse(await readFile(absolute, "utf8"));
        const expected = join(dirname(absolute), `${content.id}.json`);
        if (absolute !== expected) throw new Error("Report input must use its immutable <id>.json filename");
        return loadReport(dirname(absolute), content.id);
      }));
    }
    if (command === "local") {
      const location = relative(reports[0].source.repository, output);
      if (!location || (location !== ".." && !location.startsWith(`..${sep}`) && !isAbsolute(location))) {
        throw new Error("--out must be outside the analyzed repository to avoid polluting future snapshots");
      }
      const report = reports[0];
      const files = (records, scope) => records.map((file) => ({
        ...file, diff: getLocalFileDiff({ cwd: report.source.repository, report, scope, path: file.path,
          maxOutputBytes: 128 * 1024 * 1024 }),
      }));
      reports = [createReport({
        ...report, files: files(report.metrics.fileMetrics, "whole"),
        commits: report.commits.map((commit, index) => ({ ...commit, files: files(commit.files, `commit:${index}`) })),
        layers: report.layers.map((layer) => ({ ...layer, files: files(layer.metrics.fileMetrics, layer.id) })),
      })];
      if (analyzeLocal({ cwd: values.cwd, base: values.base, includeWorking: values.working }).id !== report.id) {
        throw new Error("Local content changed while embedding diffs; rerun for a consistent snapshot");
      }
    }
    await mkdir(output, { recursive: true });
    for (const report of reports) console.log(await saveReport(output, report));
    const html = join(output, "review.html");
    await writeFile(html, renderReports(reports), { mode: 0o600 });
    console.log(html);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
