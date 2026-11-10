import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { snapshotPlugins, changePlugins } from "../src/metric-plugins/index.mjs";
import { textShape } from "../src/metric-plugins/text-shape.mjs";
import { changedLines } from "../src/metric-plugins/diff-lines.mjs";
import { measured, validatePlugins } from "../src/metric-plugins/runner.mjs";
import { analyzeChangedLines, analyzeSnapshot, compareSnapshots, addAlternativeMetrics, metricCatalog } from "../src/metric-analysis.mjs";
import { measure } from "../src/metrics.mjs";

const file = (before, after, path = "src/file.js", additions = 1) => ({
  path, status: "modified", additions, deletions: 0, patchState: "complete",
  alternativeMetrics: compareSnapshots(analyzeSnapshot(Buffer.from(before), path), analyzeSnapshot(Buffer.from(after), path),
    analyzeChangedLines({ before: textShape(before).lines, after: textShape(after).lines }, path)),
});

test("Text plugins define line boundaries, code-point lengths, thresholds and whitespace", () => {
  const empty = analyzeSnapshot(Buffer.alloc(0), "x.txt");
  assert.equal(empty.bytes.value, 0);
  assert.equal(empty["blank-lines"].value, 0);
  assert.equal(empty["max-line-length"].value, 0);
  const s = analyzeSnapshot(Buffer.from(`😀${"x".repeat(119)}\r\n${"😀".repeat(121)}\n \tfoo \t\n\t \tbar\n\n`), "x.txt");
  assert.equal(s["max-line-length"].value, 121);
  assert.equal(s["long-lines"].value, 1);
  assert.equal(s["blank-lines"].value, 1);
  assert.equal(s["trailing-whitespace"].value, 1);
  assert.equal(s.indentation.value, 8);
  assert.deepEqual(textShape("a\r\nb\r\n").lines, ["a", "b"]);
  assert.deepEqual(textShape("a\n").lines, ["a"]);
  assert.deepEqual(textShape("\n").lines, [""]);
  assert.deepEqual(textShape("a").lines, ["a"]);
  assert.deepEqual(textShape("a\r").lines, ["a\r"]);
});

test("Repeated lines are trimmed and file-local; absolute counts, means and maxima aggregate correctly", () => {
  const m = measure([
    file("x\n", "a\n a \n\n"),
    file("xxxx\nzz\n", "a\n"),
  ]);
  assert.equal(m.alternativeMetrics["repeated-lines"].after.value, 1);
  assert.equal(m.alternativeMetrics["blank-lines"].after.value, 1);
  assert.equal(m.alternativeMetrics["mean-line-length"].before.value, 7 / 3);
  assert.equal(m.alternativeMetrics["max-line-length"].before.value, 4);
  assert.equal(m.categories.source.alternativeMetrics["max-line-length"].before.value, 4);
  assert.equal(m.fileMetrics[0].alternativeMetrics["repeated-lines"].after.value, 1);
  assert.equal(m.alternativeMetrics.bytes.after.value, Buffer.byteLength("a\n a \n\na\n"));
});

test("Binary, unknown languages, missing snapshots and empty additions stay distinct", () => {
  const b = analyzeSnapshot(Buffer.from([0, 1]), "x.js");
  assert.equal(b.bytes.value, 2);
  assert.equal(b["blank-lines"].status, "unsupported");
  assert.equal(analyzeSnapshot(Buffer.from([0xff]), "x.js")["blank-lines"].status, "unsupported");
  const legacy = measure([
    { path: "x.js", status: "modified", additions: 1, deletions: 0 },
    file("a\n", "\n"),
    { path: "x.png", status: "modified", binary: true, additions: 0, deletions: 0, beforeBytes: 2, afterBytes: 3 },
  ]);
  assert.equal(legacy.alternativeMetrics["blank-lines"].after.status, "partial");
  assert.equal(legacy.alternativeMetrics["blank-lines"].after.eligible, 2);
  assert.equal(legacy.alternativeMetrics["blank-lines"].after.measured, 1);
  assert.equal(legacy.alternativeMetrics["blank-lines"].after.value, 1);
  assert.equal(legacy.alternativeMetrics["blank-lines"].changes.additions.status, "partial");
  const added = measure([{ path: "a.py", status: "added", additions: 0, deletions: 0 }]);
  assert.equal(added.fileMetrics[0].alternativeMetrics.bytes.before.value, 0);
  assert.equal(added.fileMetrics[0].alternativeMetrics["blank-lines"].before.value, 0);
  assert.equal(added.fileMetrics[0].alternativeMetrics["blank-lines"].after.status, "missing-content");
  assert.equal(measure([]).alternativeMetrics.bytes.after.status, "not-applicable");
});

test("Text churn is absolute and additive, including zero-line renames", () => {
  const plugin = changePlugins[0];
  assert.deepEqual(plugin.measure({ additions: 3, deletions: 2 }), { additions: 3, deletions: 2 });
  const m = measure([file("", "x", "x.js", 3), file("", "y", "x.py", 1)]);
  assert.deepEqual(m.fileMetrics.map((f) => f.alternativeMetrics.churn.changes.additions.value), [3, 1]);
  assert.equal(m.alternativeMetrics.churn.changes.additions.value, 4);
  const rename = measure([{ path: "a.py", status: "renamed", additions: 0, deletions: 0 }]);
  assert.equal(rename.alternativeMetrics.churn.changes.additions.value, 0);
  assert.equal(rename.alternativeMetrics["blank-lines"].changes.deletions.value, 0);
  const empty = measure([]);
  assert.equal(empty.alternativeMetrics.churn.changes.additions.value, 0);
  assert.equal(empty.alternativeMetrics["long-lines"].changes.deletions.value, 0);
  assert.equal(empty.alternativeMetrics["long-lines"].changes.additions.eligible, 0);
});

test("Diffstat measurements count seven added and one removed long line, not the net six", () => {
  const before = "x".repeat(121);
  const after = Array.from({ length: 7 }, (_, i) => `${i}${"y".repeat(120)}`);
  const patch = `@@ -1 +1,7 @@\n-${before}\n${after.map((line) => `+${line}`).join("\n")}`;
  const lines = changedLines(patch, 7, 1);
  const changes = analyzeChangedLines(lines, "a.js");
  const m = compareSnapshots(analyzeSnapshot(Buffer.from(`${before}\n`), "a.js"),
    analyzeSnapshot(Buffer.from(`${after.join("\n")}\n`), "a.js"), changes);
  assert.equal(m["long-lines"].changes.additions.value, 7);
  assert.equal(m["long-lines"].changes.deletions.value, 1);
  assert.equal(m["long-lines"].delta, 6);
  const replacement = analyzeChangedLines({ before: [before], after: [after[0]] }, "a.js");
  assert.equal(replacement.before["long-lines"].value, 1);
  assert.equal(replacement.after["long-lines"].value, 1);
});

test("Unified patches preserve header-looking content, context, CRLF and no-newline markers", () => {
  const parsed = changedLines("--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n keep\n--- heading\r\n+++ heading\r\n\\ No newline at end of file\n@@ -8,0 +9 @@\n+\n", 2, 1);
  assert.deepEqual(parsed, { before: ["-- heading\r"], after: ["++ heading\r", ""] });
  assert.equal(analyzeChangedLines(parsed, "a.js").after["blank-lines"].value, 1);
  assert.throws(() => changedLines("@@ -1 +1,2 @@\n-old\n+new", 2, 1), /Incomplete/);
  assert.throws(() => changedLines("-old\n+new", 1, 1), /Incomplete/);
});

test("Saved ratio numerators migrate to counts without inventing changed-line evidence", () => {
  const side = (count, lines) => ({ numerator: count, denominator: lines, value: count / lines * 100,
    status: "available", measured: 1, eligible: 1, reasons: [] });
  const old = { version: 1, before: side(3, 10), after: side(4, 8), delta: 20 };
  const m = measure([{ path: "a.js", status: "modified", additions: 5, deletions: 2,
    alternativeMetrics: { "blank-share": old, "long-line-share": old, repetition: old,
      "trailing-whitespace": old, "comment-share": old } }]);
  for (const id of ["blank-lines", "long-lines", "trailing-whitespace", "repeated-lines", "comment-lines"]) {
    assert.equal(m.alternativeMetrics[id].before.value, 3, id);
    assert.equal(m.alternativeMetrics[id].after.value, 4, id);
    if (id !== "repeated-lines") assert.equal(m.alternativeMetrics[id].changes.additions.status, "missing-content", id);
  }
  assert.ok(metricCatalog.every((definition) => !definition.label.endsWith("share") && definition.unit !== "%"));
  assert.equal(old.before.value, 30);
});

test("Plugin validation rejects bad evidence, and language-independent modules stay isolated", () => {
  assert.throws(() => validatePlugins([...snapshotPlugins, snapshotPlugins[0]]), /duplicate/);
  assert.throws(() => measured(snapshotPlugins[0], { numerator: NaN, denominator: 1 }), /Invalid/);
  assert.equal(measured(snapshotPlugins[0], { numerator: 1, denominator: 1, source: "must not survive" }).source, undefined);
  const m = measure([file("", "x")]);
  m.fileMetrics[0].alternativeMetrics.bytes.after.numerator = Infinity;
  assert.throws(() => addAlternativeMetrics(m), /Invalid saved/);
  const directory = new URL("../src/metric-plugins/", import.meta.url);
  for (const name of readdirSync(directory)) {
    const imports = [...readFileSync(new URL(name, directory), "utf8").matchAll(/from\s+["']([^"']+)["']/g)];
    for (const [, path] of imports) assert.match(path, /^\.\/[^/]+\.mjs$/);
  }
});

test("Reaggregation never mixes incompatible metric versions", () => {
  const m = measure([file("x", "xx")]);
  m.fileMetrics[0].alternativeMetrics.bytes.version = 0;
  const upgraded = addAlternativeMetrics(m);
  assert.equal(upgraded.alternativeMetrics.bytes.before.status, "missing-content");
  assert.equal(upgraded.alternativeMetrics.bytes.after.value, null);
  assert.match(upgraded.alternativeMetrics.bytes.after.reasons[0], /version differs/);
});
