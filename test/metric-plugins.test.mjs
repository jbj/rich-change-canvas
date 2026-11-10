import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { snapshotPlugins, changePlugins } from "../src/metric-plugins/index.mjs";
import { textShape } from "../src/metric-plugins/text-shape.mjs";
import { measured, validatePlugins } from "../src/metric-plugins/runner.mjs";
import { analyzeSnapshot, compareSnapshots, addAlternativeMetrics } from "../src/metric-analysis.mjs";
import { measure } from "../src/metrics.mjs";

const file = (before, after, path = "src/file.js", additions = 1) => ({
  path, status: "modified", additions, deletions: 0, patchState: "complete",
  alternativeMetrics: compareSnapshots(analyzeSnapshot(Buffer.from(before), path), analyzeSnapshot(Buffer.from(after), path)),
});

test("Text plugins define line boundaries, code-point lengths, thresholds and whitespace", () => {
  const empty = analyzeSnapshot(Buffer.alloc(0), "x.txt");
  assert.equal(empty.bytes.value, 0);
  assert.equal(empty["blank-share"].status, "not-applicable");
  assert.equal(empty["max-line-length"].value, 0);
  const s = analyzeSnapshot(Buffer.from(`😀${"x".repeat(119)}\r\n${"😀".repeat(121)}\n \tfoo \t\n\t \tbar\n\n`), "x.txt");
  assert.equal(s["max-line-length"].value, 121);
  assert.equal(s["long-line-share"].value, 20);
  assert.equal(s["blank-share"].value, 20);
  assert.equal(s["trailing-whitespace"].value, 20);
  assert.equal(s.indentation.value, 8);
  assert.deepEqual(textShape("a\r\nb\r\n").lines, ["a", "b"]);
  assert.deepEqual(textShape("a\n").lines, ["a"]);
  assert.deepEqual(textShape("\n").lines, [""]);
  assert.deepEqual(textShape("a").lines, ["a"]);
  assert.deepEqual(textShape("a\r").lines, ["a\r"]);
});

test("Repeated lines are trimmed and file-local; ratios/means/maxima aggregate correctly", () => {
  const m = measure([
    file("x\n", "a\n a \n\n"),
    file("xxxx\nzz\n", "a\n"),
  ]);
  assert.ok(Math.abs(m.alternativeMetrics.repetition.after.value - 100 / 3) < 1e-12);
  assert.equal(m.alternativeMetrics["blank-share"].after.value, 25);
  assert.equal(m.alternativeMetrics["mean-line-length"].before.value, 7 / 3);
  assert.equal(m.alternativeMetrics["max-line-length"].before.value, 4);
  assert.equal(m.categories.source.alternativeMetrics["max-line-length"].before.value, 4);
  assert.equal(m.fileMetrics[0].alternativeMetrics.repetition.after.value, 50);
  assert.equal(m.alternativeMetrics.bytes.after.value, Buffer.byteLength("a\n a \n\na\n"));
});

test("Binary, unknown languages, missing snapshots and empty additions stay distinct", () => {
  const b = analyzeSnapshot(Buffer.from([0, 1]), "x.js");
  assert.equal(b.bytes.value, 2);
  assert.equal(b["blank-share"].status, "unsupported");
  assert.equal(analyzeSnapshot(Buffer.from([0xff]), "x.js")["blank-share"].status, "unsupported");
  const legacy = measure([
    { path: "x.js", status: "modified", additions: 1, deletions: 0 },
    file("a\n", "\n"),
    { path: "x.png", status: "modified", binary: true, additions: 0, deletions: 0, beforeBytes: 2, afterBytes: 3 },
  ]);
  assert.equal(legacy.alternativeMetrics["blank-share"].after.status, "partial");
  assert.equal(legacy.alternativeMetrics["blank-share"].after.eligible, 2);
  assert.equal(legacy.alternativeMetrics["blank-share"].after.measured, 1);
  assert.equal(legacy.alternativeMetrics["blank-share"].after.value, 100);
  const added = measure([{ path: "a.py", status: "added", additions: 0, deletions: 0 }]);
  assert.equal(added.fileMetrics[0].alternativeMetrics.bytes.before.value, 0);
  assert.equal(added.fileMetrics[0].alternativeMetrics["blank-share"].before.status, "not-applicable");
  assert.equal(added.fileMetrics[0].alternativeMetrics["blank-share"].after.status, "missing-content");
  assert.equal(measure([]).alternativeMetrics.bytes.after.status, "not-applicable");
});

test("Churn shares, concentration and entropy use the selected scope, including zero churn", () => {
  const plugin = changePlugins[0];
  assert.deepEqual(plugin.measure([{ additions: 1, deletions: 0 }]),
    { shares: [100], largestShare: 100, entropy: 0 });
  assert.deepEqual(plugin.measure([{ additions: 1, deletions: 0 }, { additions: 0, deletions: 1 }]),
    { shares: [50, 50], largestShare: 50, entropy: 1 });
  assert.deepEqual(plugin.measure([{ additions: 0, deletions: 0 }]),
    { shares: [null], largestShare: null, entropy: null });
  const m = measure([file("", "x", "x.js", 3), file("", "y", "x.py", 1)]);
  assert.deepEqual(m.fileMetrics.map((f) => f.alternativeMetrics["churn-share"].value), [75, 25]);
  assert.equal(m.alternativeMetrics["churn-share"].largestShare, 75);
  assert.ok(Math.abs(m.alternativeMetrics["churn-share"].entropy - 0.8112781244591328) < 1e-12);
});

test("Plugin validation rejects bad evidence, and language-independent modules stay isolated", () => {
  assert.throws(() => validatePlugins([...snapshotPlugins, snapshotPlugins[0]]), /duplicate/);
  assert.throws(() => measured(snapshotPlugins[0], { numerator: NaN, denominator: 1 }), /Invalid/);
  const m = measure([file("", "x")]);
  m.fileMetrics[0].alternativeMetrics.bytes.after.numerator = Infinity;
  assert.throws(() => addAlternativeMetrics(m), /Invalid saved/);
  const directory = new URL("../src/metric-plugins/", import.meta.url);
  for (const name of readdirSync(directory)) {
    const imports = [...readFileSync(new URL(name, directory), "utf8").matchAll(/from\s+["']([^"']+)["']/g)];
    for (const [, path] of imports) assert.match(path, /^\.\/[^/]+\.mjs$/);
  }
});
