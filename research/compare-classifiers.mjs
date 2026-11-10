// Compare the working-tree classifier with the classifier at a git ref, over the survey corpus.
//
//   node research/compare-classifiers.mjs [--base HEAD] [--cache DIR] [--examples 3] [--from other] [--to source]
//
// Prints a transition table (old category -> new category) with example paths, so rule changes can be
// reviewed for unintended moves, not only for a lower "other" share. Run survey-files.mjs first to fill the cache.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { classify } from "../src/metrics.mjs";
import { loadSurvey } from "./survey-files.mjs";

const { values } = parseArgs({ options: {
  base: { type: "string", default: "HEAD" },
  cache: { type: "string", default: join(tmpdir(), "rich-change-survey") },
  examples: { type: "string", default: "3" },
  from: { type: "string" }, to: { type: "string" },
}, strict: false });

const scratch = mkdtempSync(join(tmpdir(), "classifier-"));
try {
  const file = join(scratch, "metrics.mjs");
  writeFileSync(file, execFileSync("git", ["show", `${values.base}:src/metrics.mjs`], { encoding: "utf8" }));
  const { classify: before } = await import(pathToFileURL(file).href);
  const transitions = new Map();
  for (const { repository, paths } of loadSurvey(values.cache)) {
    for (const path of paths) {
      const from = before(path).category;
      const to = classify(path).category;
      if (from === to || (values.from && from !== values.from) || (values.to && to !== values.to)) continue;
      const key = `${from} -> ${to}`;
      const entry = transitions.get(key) ?? { count: 0, examples: [] };
      entry.count++;
      if (entry.examples.length < Number(values.examples)) entry.examples.push(`${repository}: ${path}`);
      transitions.set(key, entry);
    }
  }
  for (const [key, { count, examples }] of [...transitions].sort((a, b) => b[1].count - a[1].count)) {
    console.log(`${String(count).padStart(7)}  ${key}`);
    for (const example of examples) console.log(`           ${example}`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
