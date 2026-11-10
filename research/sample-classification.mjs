// Draw a reproducible, stratified sample of classified paths for manual review.
//
//   node research/sample-classification.mjs [--size 50] [--seed 1] [--cache DIR] [--format md|tsv]
//
// Stratification: every category gets at least ceil(size / (2 * categories)) draws, the remaining
// slots are filled proportionally to file count, repositories are drawn round-robin inside a
// category, and draws are ranked by a seeded hash of each path, so tiny repositories and rare roles are not drowned out by the largest monorepos.
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseArgs } from "node:util";
import { classify } from "../src/metrics.mjs";
import { loadSurvey } from "./survey-files.mjs";

const { values } = parseArgs({ options: {
  size: { type: "string", default: "50" }, seed: { type: "string", default: "1" },
  cache: { type: "string", default: join(tmpdir(), "rich-change-survey") },
  format: { type: "string", default: "md" },
}, strict: false });
const size = Number(values.size);

// Hash ranks keep draws stable when rule edits move other paths between categories.
const rank = (...parts) => createHash("sha256").update([values.seed, ...parts].join("\0")).digest("hex");

const byCategory = new Map();
for (const { repository, paths } of loadSurvey(values.cache)) {
  for (const path of paths) {
    const role = classify(path);
    const repos = byCategory.get(role.category) ?? new Map();
    byCategory.set(role.category, repos);
    const list = repos.get(repository) ?? [];
    list.push({ repository, path, ...role });
    repos.set(repository, list);
  }
}
const counts = [...byCategory].map(([category, repos]) =>
  [category, [...repos.values()].reduce((sum, list) => sum + list.length, 0)]);
const total = counts.reduce((sum, [, count]) => sum + count, 0);
const floor = Math.ceil(size / (2 * counts.length));
const remaining = size - floor * counts.length;
const quota = new Map(counts.map(([category, count]) => [category, floor + Math.round(remaining * count / total)]));

const sample = [];
for (const [category, repos] of [...byCategory].sort(([a], [b]) => a.localeCompare(b))) {
  const queues = [...repos].map(([repository, list]) => ({
    key: rank(category, repository),
    items: list.map((item) => ({ ...item, key: rank(item.repository, item.path) }))
      .sort((a, b) => a.key.localeCompare(b.key)),
  })).sort((a, b) => a.key.localeCompare(b.key));
  for (let taken = 0, i = 0; taken < quota.get(category) && queues.some((queue) => queue.items.length); i++) {
    const queue = queues[i % queues.length];
    if (!queue.items.length) continue;
    const { key, ...item } = queue.items.shift();
    sample.push(item);
    taken++;
  }
}

if (values.format === "tsv") {
  for (const item of sample) console.log([item.repository, item.path, item.category, item.reason].join("\t"));
} else {
  console.log("| # | Repository | Path | Category | Reason |\n|---|---|---|---|---|");
  sample.forEach((item, index) => console.log(`| ${index + 1} | ${item.repository} | \`${item.path}\` | ${item.category} | ${item.reason} |`));
}
