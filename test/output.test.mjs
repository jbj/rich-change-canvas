import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, mkdirSync, copyFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createReport, digest, loadReport, saveReport } from "../src/report.mjs";
import { renderReports } from "../src/render.mjs";
import { run } from "../src/process.mjs";
import { runInNewContext } from "node:vm";
import { reportsFromCorpus } from "../src/corpus.mjs";
import { analyzeChangedLines, analyzeSnapshot, compareSnapshots } from "../src/metric-analysis.mjs";
import { physicalLines } from "../src/metric-plugins/text-shape.mjs";
import { pathToFileURL } from "node:url";

const cli = resolve("cli.mjs");
function temporary(t) {
  const root = mkdtempSync(join(tmpdir(), "rich-output-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function sample() {
  return createReport({
    source: { kind: "fixture", repository: "fixture" },
    title: "</script><img src=x onerror=alert(1)> __NONCE__",
    comparison: { baseSha: "base", mergeBaseSha: "base", headSha: "head" },
    files: [{ path: "asset.bin", status: "modified", binary: true,
      additions: 0, deletions: 0, beforeBytes: 4, afterBytes: 9, patchState: "binary" }],
  });
}

function reviewPage(...reports) {
  return reviewHtml(renderReports(reports));
}

function reviewHtml(html) {
  const fetchRequests = [];
  const resizeObservers = [];
  class Element {
    children = [];
    value = "";
    hidden = false;
    open = false;
    dataset = {};
    events = {};
    attributes = {};
    style = { setProperty(name, value) { this[name] = value; } };
    bounds = { width: 0 };
    clientWidth = 1000;
    constructor(tag, text = "") { this.tag = tag; this.text = text; }
    get textContent() { return this.text + this.children.map((child) => child.textContent).join(""); }
    set textContent(value) { this.text = value; this.children = []; }
    get childElementCount() { return this.children.length; }
    get firstElementChild() { return this.children[0]; }
    getBoundingClientRect() { return this.bounds; }
    append(...children) {
      for (const child of children) child.parentElement = this;
      this.children.push(...children);
    }
    remove() {
      if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    }
    cloneNode(deep) {
      const clone = Object.assign(new Element(this.tag, this.text), {
        className: this.className, hidden: this.hidden, open: this.open, bounds: { ...this.bounds },
        attributes: { ...this.attributes }, dataset: { ...this.dataset },
      });
      if (deep) clone.append(...this.children.map((child) => child.cloneNode(true)));
      return clone;
    }
    querySelector(selector) {
      const matches = (node) => selector.startsWith(".") ?
        (node.className ?? "").split(/\s+/).includes(selector.slice(1)) : node.tag === selector;
      return this.children.map((child) => descendant(child, matches)).find(Boolean);
    }
    replaceChildren(...children) { this.text = ""; this.children = children; }
    addEventListener(name, handler) { this.events[name] = handler; }
    focus() { this.focused = true; }
    setAttribute(name, value) { this.attributes[name] = value; }
    removeAttribute(name) { delete this.attributes[name]; }
  }
  const ids = [...html
    .matchAll(/<([a-z][\w-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/g)];
  const nodes = Object.fromEntries(ids.map(([, tag, attributes, id]) => [
    id, Object.assign(new Element(tag), { id, hidden: /\bhidden\b/.test(attributes), open: /\bopen\b/.test(attributes) }),
  ]));
  nodes["report-data"].textContent = html.match(/<script id="report-data"[^>]*>([\s\S]*?)<\/script>/)[1];
  const document = {
    getElementById: (id) => nodes[id],
    createElement: (tag) => new Element(tag),
    createElementNS: (namespace, tag) => new Element(tag),
    createTextNode: (text) => new Element("#text", text),
    createRange: () => ({
      selectNodeContents(node) { this.node = node; },
      getBoundingClientRect() { return this.node.getBoundingClientRect(); },
    }),
  };
  const fetch = async (url) => {
    fetchRequests.push(url);
    return { ok: true, status: 200, json: async () => ({ diff: "@@ -1 +1 @@\n-value = 1\n+value = 2\n" }) };
  };
  const script = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];
  class ResizeObserver {
    observed = new Set();
    constructor(callback) { this.callback = callback; resizeObservers.push(this); }
    observe(node) { this.observed.add(node); }
    disconnect() { this.observed.clear(); }
  }
  runInNewContext(script, {
    document, URL, fetch, encodeURIComponent, ResizeObserver, requestAnimationFrame: (callback) => callback(),
    getComputedStyle: () => ({ paddingLeft: "8px", paddingRight: "8px", lineHeight: "18px" }),
  });
  assert.equal(nodes.error.textContent, "");
  nodes.fetchRequests = fetchRequests;
  nodes.resizeObservers = resizeObservers;
  return nodes;
}

function categoryRow(page, category) {
  return page["category-rows"].children.find((row) =>
    row.className === "category-row" && row.dataset.category === category);
}
function categoryToggle(page, category) {
  return categoryRow(page, category).children[0].children[0];
}
function fileRow(page, path) {
  return page["category-rows"].children.find((row) =>
    row.className === "file-row" && row.dataset.filePath === path);
}
function diffRow(page, path) {
  return page["category-rows"].children.find((row) =>
    row.className === "diff-row" && row.dataset.filePath === path);
}
function descendant(node, predicate) {
  if (predicate(node)) return node;
  for (const child of node.children) {
    const found = descendant(child, predicate);
    if (found) return found;
  }
}
function fileRows(page) {
  return page["category-rows"].children.filter((row) => row.className === "file-row");
}

function metricFile(path, before, after, additions = 1) {
  return { path, status: "modified", additions, deletions: 1, patchState: "complete",
    alternativeMetrics: compareSnapshots(
      analyzeSnapshot(Buffer.from(before), path), analyzeSnapshot(Buffer.from(after), path),
      analyzeChangedLines({ before: physicalLines(before), after: physicalLines(after) }, path)) };
}

test("Metric selection drives absolute diffstats without bars and retains snapshot bars", () => {
  const report = createReport({
    source: { kind: "local", repository: "fixture" }, title: "Metrics",
    comparison: { mergeBaseSha: "base", headSha: "head" },
    files: [metricFile("a.js", "x\n", "\n\nx\n"), metricFile("b.js", "x\n", "longer\n")],
  });
  const page = reviewPage(report);
  assert.equal(page.metric.value, "lines");
  assert.equal(page["bar-heading"].hidden, true);
  assert.equal(page["metric-legend"].hidden, true);
  assert.equal(categoryRow(page, "source").children.length, 2);
  assert.equal(fileRow(page, "a.js").children.length, 2);
  categoryToggle(page, "source").events.click();
  page.metric.value = "blank-lines";
  page.metric.events.change();
  assert.match(page.totals.textContent, /\+2 lines/);
  assert.equal(categoryRow(page, "source").children[1].textContent, "+2 lines");
  assert.equal(fileRow(page, "a.js").children[1].textContent, "+2 lines");
  assert.equal(fileRow(page, "b.js"), undefined);
  assert.equal(categoryToggle(page, "source").textContent, "Source · 1");
  assert.equal(fileRow(page, "a.js").hidden, false);
  assert.equal(page["value-heading"].textContent, "+added / −removed");
  assert.equal(categoryRow(page, "source").children.length, 2);
  assert.equal(fileRow(page, "a.js").children.length, 2);
  assert.equal(page["bar-heading"].hidden, true);
  assert.equal(page["metric-legend"].hidden, true);
  page.metric.value = "bytes";
  page.metric.events.change();
  assert.match(page.totals.textContent, /4 → 11 B \(Δ \+7\)/);
  assert.match(categoryRow(page, "source").children[1].textContent, /4 → 11 B/);
  assert.match(page["line-scale"].textContent, /0–11 B/);
  const snapshots = categoryRow(page, "source").children[2].children[0].children;
  assert.deepEqual(snapshots.map((rect) => rect.attributes.class), ["bar-before", "bar-after"]);
  assert.deepEqual(snapshots.map((rect) => rect.attributes.y), ["0", "5"]);
  assert.equal(page["bar-heading"].hidden, false);
  assert.equal(page["metric-legend"].hidden, false);
  assert.equal(page["bar-heading"].textContent, "Snapshots");
  assert.equal(categoryRow(page, "source").children.length, 3);
  assert.equal(fileRow(page, "a.js").children.length, 3);
  assert.equal(diffRow(page, "a.js").children[0].colSpan, 3);
  assert.deepEqual(snapshots.map((rect) => Number(rect.attributes.width)), [4 / 11 * 100, 100]);
  page.metric.value = "repeated-lines";
  page.metric.events.change();
  assert.match(page.totals.textContent, /0 → 0 lines/);
  assert.equal(page["value-heading"].textContent, "Before → after (Δ)");
  page.metric.value = "lines";
  page.metric.events.change();
  assert.match(categoryRow(page, "source").children[1].textContent, /\+2 \/ -2/);
  assert.equal(page["bar-heading"].hidden, true);
  assert.equal(categoryRow(page, "source").children.length, 2);
  assert.equal(diffRow(page, "a.js").children[0].colSpan, 2);
});

test("Text churn exposes absolute added/removed counts, including zero-line renames", () => {
  const report = createReport({
    source: { kind: "fixture", repository: "fixture" }, title: "Shares",
    comparison: {}, files: [
      metricFile("a.js", "x", "y", 2),
      { ...metricFile("b.js", "x", "y", 1), deletions: 0 },
    ],
  });
  const page = reviewPage(report);
  page.metric.value = "churn";
  page.metric.events.change();
  assert.equal(fileRow(page, "a.js").children[1].textContent, "+2 / -1 lines");
  assert.equal(fileRow(page, "b.js").children[1].textContent, "+1 lines");
  assert.match(page.totals.textContent, /\+3 \/ -1 lines/);
  assert.doesNotMatch(page.totals.textContent, /Δ|→/);
  assert.equal(page["bar-heading"].textContent, "Snapshots");
  assert.equal(page["bar-heading"].hidden, true);
  assert.equal(page["metric-legend"].hidden, true);
  assert.equal(fileRow(page, "a.js").children.length, 2);
  assert.equal(categoryRow(page, "source").children.length, 2);
  assert.doesNotMatch(page.totals.textContent, /%|entropy|concentration/);
  const rename = createReport({
    source: { kind: "fixture", repository: "fixture" }, title: "Rename",
    comparison: {}, files: [{ path: "new.md", previousPath: "old.md", status: "renamed", additions: 0, deletions: 0 }],
  });
  const empty = reviewPage(rename);
  empty.metric.value = "churn";
  empty.metric.events.change();
  assert.doesNotMatch(empty.totals.textContent, /[+-]0/);
  assert.equal(fileRow(empty, "new.md").children[1].textContent, "±0 lines");
  assert.equal(fileRow(empty, "new.md").children[1].children[0].children[0].className, "zero");
  assert.equal(categoryRow(empty, "documentation").children[1].textContent, "±0 lines");
});

test("Long-line diffstats render seven added and one removed without bars", () => {
  const before = "x".repeat(121), added = Array.from({ length: 7 }, (_, i) => `${i}${"y".repeat(120)}`);
  const report = createReport({
    source: { kind: "fixture", repository: "fixture" }, title: "Long lines",
    comparison: {}, files: [metricFile("a.js", `${before}\n`, `${added.join("\n")}\n`, 7)],
  });
  const page = reviewPage(report);
  page.metric.value = "long-lines";
  page.metric.events.change();
  assert.match(page.totals.textContent, /\+7 \/ -1 lines/);
  assert.doesNotMatch(page.totals.textContent, /\+6|%/);
  assert.match(fileRow(page, "a.js").children[1].textContent, /\+7 \/ -1/);
  assert.equal(categoryRow(page, "source").children.length, 2);
  assert.equal(fileRow(page, "a.js").children.length, 2);
  assert.equal(page["bar-heading"].hidden, true);
  assert.equal(page["metric-legend"].hidden, true);
});

test("Diffstats omit zero sides and zero-only rows without losing expansion across metric filters", () => {
  const report = createReport({
    source: { kind: "fixture", repository: "fixture" }, title: "Zeros",
    comparison: {}, files: [
      { ...metricFile("added.js", "", "\n".repeat(48), 48), deletions: 0 },
      { ...metricFile("removed.js", "\n\n\n", "", 0), deletions: 3 },
      { ...metricFile("unchanged.js", "x\n", "y\n", 0), deletions: 0 },
      { ...metricFile("docs/zero.md", "x\n", "y\n", 0), deletions: 0 },
    ],
  });
  const page = reviewPage(report);
  for (const id of ["lines", "churn", "blank-lines"]) {
    page.metric.value = id;
    page.metric.events.change();
    const added = fileRow(page, "added.js").children[1].children[0];
    const removed = fileRow(page, "removed.js").children[1].children[0];
    assert.equal(added.textContent, `+48${id === "lines" ? "" : " lines"}`);
    assert.equal(added.children[0].className, "added");
    assert.equal(removed.textContent, `-3${id === "lines" ? "" : " lines"}`);
    assert.equal(removed.children[0].className, "deleted");
    assert.equal(fileRow(page, "unchanged.js"), undefined);
    assert.equal(diffRow(page, "unchanged.js"), undefined);
    assert.equal(categoryRow(page, "documentation"), undefined);
    assert.equal(categoryToggle(page, "source").textContent, "Source · 2");
    assert.doesNotMatch(page.totals.textContent, /[+-]0/);
  }
  categoryToggle(page, "source").events.click();
  page.metric.value = "long-lines";
  page.metric.events.change();
  assert.equal(page["category-rows"].children.length, 0);
  assert.equal(page["role-empty"].hidden, false);
  assert.equal(page["role-empty"].textContent, "No changes for this metric.");
  assert.doesNotMatch(page.totals.textContent, /[+-]0/);
  page.metric.value = "blank-lines";
  page.metric.events.change();
  assert.equal(fileRow(page, "added.js").hidden, false);
});

test("Unknown and partially measured zeros stay visible rather than becoming no-change rows", () => {
  const report = createReport({
    source: { kind: "fixture", repository: "fixture" }, title: "Unknown zeros",
    comparison: {}, files: [
      metricFile("zero.js", "x\n", "y\n"),
      { path: "unknown.js", status: "modified", additions: 1, deletions: 1 },
    ],
  });
  const page = reviewPage(report);
  page.metric.value = "blank-lines";
  page.metric.events.change();
  assert.equal(fileRow(page, "zero.js"), undefined);
  assert.ok(fileRow(page, "unknown.js"));
  assert.match(categoryRow(page, "source").textContent, /±0 \(partial\)/);
  assert.match(fileRow(page, "unknown.js").textContent, /Unavailable/);
  assert.equal(page["role-empty"].hidden, true);
});

test("Inapplicable metric rows are omitted while missing measurements stay visible", () => {
  const report = createReport({
    source: { kind: "local", repository: "fixture" }, title: "Applicability",
    comparison: {}, files: [
      metricFile("README.md", "# Before\n", "# After\n"),
      metricFile("module.js", "", "function example() {}\n"),
      { path: "test/unknown.js", status: "modified", additions: 1, deletions: 1 },
    ],
  });
  const page = reviewPage(report);
  assert.ok(fileRow(page, "README.md"));
  page.metric.value = "declaration-lines";
  page.metric.events.change();
  assert.equal(fileRow(page, "README.md"), undefined);
  assert.equal(diffRow(page, "README.md"), undefined);
  assert.equal(categoryRow(page, "documentation"), undefined);
  assert.equal(fileRow(page, "module.js").children[1].textContent, "+1 lines");
  assert.match(fileRow(page, "test/unknown.js").textContent, /Unavailable/);
  assert.doesNotMatch(page["category-rows"].textContent, /N\/A/);
  page.metric.value = "lines";
  page.metric.events.change();
  assert.ok(fileRow(page, "README.md"));

  const docs = reviewPage(createReport({
    source: report.source, title: "Docs only", comparison: {},
    files: [metricFile("README.md", "# Before\n", "# After\n")],
  }));
  docs.metric.value = "declaration-lines";
  docs.metric.events.change();
  assert.equal(docs["category-rows"].children.length, 0);
  assert.equal(docs["role-empty"].hidden, false);
  assert.match(docs["role-empty"].textContent, /does not apply/);
  assert.match(docs.totals.textContent, /Not applicable/);
  assert.doesNotMatch(docs.totals.textContent, /N\/A|±0/);
});

test("Renames across supported languages show only applicable diffstat sides", () => {
  for (const [beforePath, afterPath, before, after, expected] of [
    ["README.md", "module.js", "# Docs\n", "function example() {}\n", "+1 lines"],
    ["module.js", "README.md", "function example() {}\n", "# Docs\n", "-1 lines"],
  ]) {
    const file = {
      path: afterPath, previousPath: beforePath, status: "renamed", additions: 1, deletions: 1,
      alternativeMetrics: compareSnapshots(
        analyzeSnapshot(Buffer.from(before), beforePath), analyzeSnapshot(Buffer.from(after), afterPath),
        analyzeChangedLines({ before: physicalLines(before), after: physicalLines(after) }, beforePath, afterPath)),
    };
    const page = reviewPage(createReport({
      source: { kind: "fixture", repository: "fixture" }, title: "Rename", comparison: {}, files: [file],
    }));
    page.metric.value = "declaration-lines";
    page.metric.events.change();
    assert.equal(fileRow(page, afterPath).children[1].textContent, expected);
    assert.doesNotMatch(page.totals.textContent, /N\/A/);
  }
});

test("Zero-text commit navigation retains rename evidence with neutral ±0", () => {
  const rename = { path: "new.js", previousPath: "old.js", status: "renamed", additions: 0, deletions: 0 };
  const report = createReport({
    source: { kind: "fixture", repository: "fixture" }, title: "Rename",
    comparison: {}, files: [rename],
    commits: [{ sha: "rename", parentCount: 1, subject: "Rename only", files: [rename] }],
  });
  const page = reviewPage(report);
  assert.match(page["commit-list"].textContent, /Rename only/);
  assert.match(page["commit-list"].textContent, /±0/);
  assert.doesNotMatch(page["commit-list"].textContent, /[+-]0/);
  assert.doesNotMatch(page["report-rows"].textContent, /[+-]0/);
  page["commit-list"].children[0].children[0].events.click();
  assert.equal(page.scope.value, "commit:0");
  categoryToggle(page, "source").events.click();
  assert.equal(fileRow(page, "new.js").children[1].textContent, "±0");
  assert.equal(fileRow(page, "new.js").children[1].children[0].children[0].className, "zero");
  assert.match(diffRow(page, "new.js").textContent, /Previous path: old.js/);
});

test("Counts with unavailable patches show honest diffstat availability and known whole-file totals", () => {
  const f = metricFile("a.js", "x\n", "\n\n");
  delete f.alternativeMetrics["blank-lines"].changes;
  const report = createReport({
    source: { kind: "fixture", repository: "fixture" }, title: "No patch",
    comparison: {}, files: [f],
  });
  const page = reviewPage(report);
  page.metric.value = "blank-lines";
  page.metric.events.change();
  assert.match(page.totals.textContent, /\+Unavailable \/ -Unavailable lines \(whole file: 0 → 2\)/);
  assert.match(page.totals.textContent, /changed-line evidence was not retained/);
});

test("The selected metric survives scope/report changes and missing evidence never becomes zero", () => {
  const report = createReport({
    source: { kind: "fixture", repository: "fixture" }, title: "Full",
    comparison: {}, files: [metricFile("a.py", "x\n", "if x:\n    pass\n")],
    commits: [{ sha: "abc", parentCount: 1, subject: "Commit", files: [metricFile("a.py", "x\n", "\n")] }],
  });
  const old = createReport({
    source: { kind: "corpus", repository: "older" }, title: "No content",
    comparison: {}, files: [{ path: "a.py", status: "modified", additions: 1, deletions: 1 }],
  });
  old.metricCatalog = old.metricCatalog.map((entry) => entry.id === "decision-keywords" ?
    { ...entry, description: "Archived lexical definition." } : entry);
  const page = reviewPage(report, old);
  page.metric.value = "decision-keywords";
  page.metric.events.change();
  assert.match(page["metric-note"].textContent, /Regex heuristic.*Not cyclomatic/);
  assert.match(page.totals.textContent, /\+1 occurrences/);
  page.scope.value = "commit:0";
  page.scope.events.change();
  assert.equal(page.metric.value, "decision-keywords");
  assert.doesNotMatch(page.totals.textContent, /[+-]0/);
  assert.equal(fileRows(page).length, 0);
  assert.equal(page["role-empty"].hidden, false);
  page.report.value = "1";
  page.report.events.change();
  assert.equal(page.metric.value, "decision-keywords");
  assert.match(page["metric-note"].textContent, /Archived lexical definition/);
  assert.match(page.totals.textContent, /\+Unavailable \/ -Unavailable/);
  assert.match(page.totals.textContent, /changed-line evidence was not retained/);
  assert.doesNotMatch(page.totals.textContent, /±0/);
});

test("Partial coverage is visible and content metrics retain working file diff interactions", async () => {
  const report = createReport({
    source: { kind: "local", repository: "fixture" }, title: "Partial",
    comparison: {}, files: [
      metricFile("a.js", "x\n", "\n"),
      { path: "b.js", status: "modified", additions: 1, deletions: 1 },
    ],
  });
  const page = reviewPage(report);
  page.metric.value = "blank-lines";
  page.metric.events.change();
  assert.match(page.totals.textContent, /\+1 \(partial\)/);
  assert.match(page.totals.textContent, /1\/2 eligible files measured; partial/);
  categoryToggle(page, "source").events.click();
  const details = fileRow(page, "a.js").children[0].children[0];
  details.open = true;
  details.events.toggle();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(page.fetchRequests, ["/diff?scope=whole&path=a.js"]);
});

test("Renderer upgrades legacy metric availability without changing the saved report identity", async (t) => {
  const report = createReport({
    source: { kind: "fixture", repository: "fixture" }, title: "Legacy",
    comparison: {}, files: [metricFile("a.js", "x\n", "longer\n")],
  });
  delete report.metricCatalog;
  delete report.metrics.alternativeMetrics;
  for (const group of Object.values(report.metrics.categories)) delete group.alternativeMetrics;
  for (const file of report.metrics.fileMetrics) delete file.alternativeMetrics;
  report.analyzerVersion = "absolute-counts-v1";
  const { id, ...legacyContent } = report;
  report.id = digest(JSON.stringify(legacyContent));
  const directory = temporary(t);
  await saveReport(directory, report);
  assert.deepEqual(await loadReport(directory, report.id), report);
  const content = JSON.stringify(report);
  const html = renderReports([report]);
  assert.equal(JSON.stringify(report), content);
  const embedded = JSON.parse(html.match(/<script id="report-data"[^>]*>([\s\S]*?)<\/script>/)[1])[0];
  assert.equal(embedded.id, report.id);
  const page = reviewPage(embedded);
  page.metric.value = "blank-lines";
  page.metric.events.change();
  assert.match(page.totals.textContent, /\+Unavailable \/ -Unavailable/);
  page.metric.value = "churn";
  page.metric.events.change();
  assert.match(page.totals.textContent, /\+1 \/ -1 lines/);
});

test("Archived share metrics display as absolute counts without mutating saved evidence", () => {
  const report = createReport({
    source: { kind: "fixture", repository: "fixture" }, title: "Archived shares",
    comparison: {}, files: [{ path: "a.js", status: "modified", additions: 2, deletions: 1 }],
  });
  const ratio = (count, lines) => ({ numerator: count, denominator: lines, value: count / lines * 100,
    status: "available", eligible: 1, measured: 1, reasons: [] });
  report.metrics.fileMetrics[0].alternativeMetrics = {
    "blank-share": { version: 1, before: ratio(3, 10), after: ratio(4, 8), delta: 20 },
  };
  report.metricCatalog = [{ id: "blank-share", version: 1, label: "Blank-line share", mode: "snapshot", unit: "%" }];
  const original = JSON.stringify(report);
  const html = renderReports([report]);
  assert.equal(JSON.stringify(report), original);
  const embedded = JSON.parse(html.match(/<script id="report-data"[^>]*>([\s\S]*?)<\/script>/)[1])[0];
  assert.ok(embedded.metricCatalog.every((definition) => !definition.label.endsWith("share") && definition.unit !== "%"));
  const page = reviewPage(embedded);
  page.metric.value = "blank-lines";
  page.metric.events.change();
  assert.match(page.totals.textContent, /whole file: 3 → 4/);
  assert.match(page.totals.textContent, /\+Unavailable \/ -Unavailable/);
  assert.doesNotMatch(page.totals.textContent, /30 → 50|%|\+1/);
});

test("Dashboard exposes independent local layers and updates the overview without tabs", () => {
  const file = (path, additions, binary = false) => ({
    path, status: "added", additions, deletions: 0, binary,
    beforeBytes: null, afterBytes: 4, patchState: binary ? "binary" : "complete",
  });
  const report = createReport({
    source: { kind: "local", repository: "fixture" }, title: "Local changes",
    comparison: { mergeBaseSha: "base", headSha: "base", mutableContentHash: "snapshot" },
    files: [],
    layers: [
      { id: "index", title: "Staged", files: [file("src/staged.js", 2)] },
      { id: "working", title: "Unstaged", files: [file("test/local.test.js", 3)] },
      { id: "untracked", title: "Untracked", files: [file("new.bin", 0, true)] },
    ],
  });
  const page = reviewPage(report);
  const rows = page["report-rows"].children;
  assert.equal(rows.length, 3);
  assert.equal(rows[0].children[1].textContent, "+2");
  assert.equal(rows[0].children[2].textContent, "±0");
  assert.equal(rows[1].children[2].textContent, "+3");
  assert.equal(rows[2].children[5].textContent, "1");
  assert.equal(report.allMetrics.files, 3);
  assert.equal(report.allMetrics.additions, 5);
  assert.equal(report.allMetrics.binaryFiles, 1);
  assert.equal(page.scope.children[0].textContent, "All · 3 files · +5");
  assert.equal(page.scope.children[1].textContent, "Committed · 0 files");
  assert.equal(page.scope.value, "all");
  assert.deepEqual(fileRows(page).map((row) => row.dataset.filePath).sort(),
    ["new.bin", "src/staged.js", "test/local.test.js"]);
  rows[1].children[0].children[0].events.click();
  assert.equal(page.scope.value, "working");
  assert.equal(page.overview.hidden, false);
  assert.doesNotMatch(readFileSync(new URL("../web/review.html", import.meta.url), "utf8"), /role="tab(list|panel)?"/);
  assert.equal(page["reports-panel"].hidden, false);
  assert.equal(page["reports-panel"].open, false);
  assert.match(page["scope-note"].textContent, /not additive/);
  assert.equal(fileRow(page, "test/local.test.js").hidden, true);
  assert.equal(fileRow(page, "src/staged.js"), undefined);
  categoryToggle(page, "test").events.click();
  assert.equal(fileRow(page, "test/local.test.js").hidden, false);
  page.shape.value = "binary";
  page.shape.events.change();
  assert.equal(page["report-rows"].children.length, 1);
  assert.match(page["report-rows"].textContent, /Untracked/);
});

test("Renderer supplies combined metrics for previously saved local reports", () => {
  const report = createReport({
    source: { kind: "local", repository: "fixture" }, title: "Saved local changes",
    comparison: { mergeBaseSha: "base", headSha: "head" },
    files: [],
    layers: [{ id: "working", title: "Unstaged", files: [{
      path: "src/working.js", status: "added", additions: 2, deletions: 0, patchState: "complete",
    }] }],
  });
  const olderReport = { ...report };
  delete olderReport.allMetrics;
  const html = renderReports([olderReport]);
  const page = reviewHtml(html);
  assert.equal(page.scope.value, "all");
  assert.match(page.totals.textContent, /\+2/);
  assert.doesNotMatch(page.totals.textContent, /-0/);
  assert.ok(fileRow(page, "src/working.js"));
});

test("All-scope duplicate file rows fetch diffs from their originating scopes", async () => {
  const file = (additions) => ({
    path: "src/value.js", status: "modified", additions, deletions: 1, patchState: "complete",
  });
  const report = createReport({
    source: { kind: "local", repository: "fixture" }, title: "Combined local changes",
    comparison: { mergeBaseSha: "base", headSha: "head" },
    files: [file(1)],
    layers: [
      { id: "index", title: "Staged", files: [file(2)] },
      { id: "working", title: "Unstaged", files: [file(3)] },
    ],
  });
  const page = reviewPage(report);
  categoryToggle(page, "source").events.click();
  const rows = fileRows(page).filter((row) => row.dataset.filePath === "src/value.js");
  assert.equal(rows.length, 3);
  for (const row of rows) {
    const details = row.children[0].children[0];
    details.open = true;
    details.events.toggle();
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.deepEqual(page.fetchRequests, [
    "/diff?scope=whole&path=src%2Fvalue.js",
    "/diff?scope=index&path=src%2Fvalue.js",
    "/diff?scope=working&path=src%2Fvalue.js",
  ]);
});

test("Loaded renderer keeps coherent assets until module reload", async (t) => {
  const root = temporary(t);
  mkdirSync(join(root, "web"));
  cpSync(resolve("src"), join(root, "src"), { recursive: true });
  for (const path of ["web/review.html", "web/review.css", "web/review.js"]) {
    copyFileSync(resolve(path), join(root, path));
  }
  const moduleUrl = pathToFileURL(join(root, "src/render.mjs")).href;
  const loaded = await import(moduleUrl);
  const original = loaded.renderReports([sample()]);
  const changes = [
    ["web/review.html", "<!-- updated template -->"],
    ["web/review.css", "/* updated style */"],
    ["web/review.js", "// updated script"],
  ];
  for (const [path, marker] of changes) {
    writeFileSync(join(root, path), `${readFileSync(join(root, path), "utf8")}\n${marker}\n`);
  }
  const nextReport = { ...sample(), title: "Next report" };
  const retained = loaded.renderReports([nextReport]);
  const fresh = await import(`${moduleUrl}?reload`);
  const refreshed = fresh.renderReports([nextReport]);
  for (const [, marker] of changes) {
    assert.ok(!retained.includes(marker));
    assert.ok(refreshed.includes(marker));
  }
  const nonce = (html) => html.match(/script-src 'nonce-([^']+)'/)[1];
  assert.notEqual(nonce(original), nonce(retained));
  assert.match(retained, /Next report/);
  assert.match(reviewHtml(retained)["review-title"].textContent, /Next report/);
  assert.match(reviewHtml(refreshed)["review-title"].textContent, /Next report/);
});

test("Single-report overview is visible immediately with details collapsed", () => {
  const page = reviewPage(sample());
  assert.equal(page["report-rows"].children.length, 1);
  assert.equal(page.scope.value, "whole");
  assert.equal(page["report-rows"].children[0].children[5].textContent, "1");
  assert.equal(page.overview.hidden, false);
  assert.equal(page["report-control"].hidden, true);
  assert.equal(page["reports-panel"].hidden, true);
  for (const id of ["commits-panel"]) {
    assert.equal(page[id].hidden, false);
    assert.equal(page[id].open, false);
  }
  assert.equal(page["files-panel"], undefined);
  assert.doesNotMatch(page.totals.textContent, /[+-]0/);
  assert.equal(page.totals.children.length, 3);
  assert.doesNotMatch(page.totals.textContent, /largest file/i);
  assert.match(categoryRow(page, "binary").textContent, /4 → 9 B/);
  assert.equal(fileRow(page, "asset.bin").hidden, true);
  assert.equal(fileRow(page, "asset.bin").children[0].children[0].children.some((child) => child.tag === "a"), false);
});

test("Text-line roles and files use balanced numeric columns without bars", () => {
  const report = createReport({
    source: { kind: "fixture", repository: "fixture" }, title: "Mixed scope",
    comparison: { mergeBaseSha: "base", headSha: "head" },
    files: [
      { path: "src/main.js", status: "modified", additions: 30, deletions: 10, patchState: "complete" },
      { path: "test/main.test.js", status: "modified", additions: 5, deletions: 5, patchState: "missing-or-truncated" },
      { path: "docs/new.md", previousPath: "docs/old.md", status: "renamed", additions: 0, deletions: 0, patchState: "rename-only" },
    ],
    warnings: ["Acquisition warning"],
  });
  const page = reviewPage(report);
  const source = categoryRow(page, "source");
  const tests = categoryRow(page, "test");
  const docs = categoryRow(page, "documentation");
  assert.equal(source.children[1].textContent, "+30 / -10");
  assert.equal(tests.children[1].textContent, "+5 / -5");
  assert.equal(docs.children[1].textContent, "±0");
  assert.equal(source.children.length, 2);
  assert.equal(tests.children.length, 2);
  assert.equal(docs.children.length, 2);
  assert.equal(page["bar-heading"].hidden, true);
  assert.equal(page["metric-legend"].hidden, true);
  assert.equal(page["evidence-panel"], undefined);
  assert.equal(page["provenance-panel"], undefined);
  const testFile = fileRow(page, "test/main.test.js");
  const docFile = fileRow(page, "docs/new.md");
  assert.equal(testFile.children.length, 2);
  assert.equal(docFile.children.length, 2);
  assert.equal(testFile.hidden, true);
  assert.equal(categoryToggle(page, "test").attributes["aria-expanded"], "false");
  categoryToggle(page, "test").events.click();
  assert.equal(testFile.hidden, false);
  assert.equal(categoryToggle(page, "test").attributes["aria-expanded"], "true");
  assert.equal(fileRow(page, "src/main.js").hidden, true);
  categoryToggle(page, "documentation").events.click();
  assert.equal(docFile.hidden, false);
  assert.match(diffRow(page, "docs/new.md").textContent, /Previous path: docs\/old.md/);
  categoryToggle(page, "documentation").events.click();
  assert.equal(docFile.hidden, true);
  assert.equal(testFile.hidden, false);
});

test("Opening a local file lazily renders its selected-scope diff", async () => {
  const report = createReport({
    source: { kind: "local", repository: "fixture" }, title: "Local changes",
    comparison: { mergeBaseSha: "base", headSha: "head" }, files: [],
    layers: [{ id: "working", title: "Unstaged", files: [
      { path: "src/value.js", status: "modified", additions: 1, deletions: 1, patchState: "complete" },
    ] }],
  });
  const page = reviewPage(report), row = fileRow(page, "src/value.js");
  categoryToggle(page, "source").events.click();
  const details = row.children[0].children[0];
  const outputRow = diffRow(page, "src/value.js"), outputCell = outputRow.children[0];
  assert.equal(outputRow.hidden, true);
  assert.equal(outputCell.colSpan, 2);
  details.open = true;
  details.events.toggle();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(page.fetchRequests, ["/diff?scope=working&path=src%2Fvalue.js"]);
  assert.equal(outputRow.hidden, false);
  const output = outputCell.children.find((child) => child.tag === "pre");
  assert.equal(output.attributes.role, "region");
  assert.match(output.textContent, /\+value = 2/);
  assert.match(readFileSync(new URL("../web/review.css", import.meta.url), "utf8"),
    /\.diff-content[^}]*contain:\s*inline-size/);
  categoryToggle(page, "source").events.click();
  assert.equal(outputRow.hidden, true);
  categoryToggle(page, "source").events.click();
  assert.equal(outputRow.hidden, false);
  details.open = false;
  details.events.toggle();
  assert.equal(outputRow.hidden, true);
});

test("Commit selection updates grouped file diffs and retains the commit link", () => {
  const file = (path, additions) => ({ path, additions, deletions: 0, status: "added", patchState: "complete" });
  const report = createReport({
    source: { kind: "fixture", repository: "fixture", url: "https://github.com/example/project/pull/1" },
    title: "History",
    comparison: { mergeBaseSha: "base", headSha: "merge" },
    files: [file("src/main.js", 2)],
    commits: [
      { sha: "ordinary", parentSha: "base", parentCount: 1, subject: "Ordinary commit",
        url: "https://github.com/example/project/commit/ordinary", files: [file("src/main.js", 4)] },
      { sha: "merge", parentSha: "ordinary", parentCount: 2, subject: "Merge commit",
        url: "https://github.com/example/project/commit/merge", files: [file("test/merge.test.js", 100)] },
    ],
  });
  const page = reviewPage(report);
  assert.equal(page["history-totals"], undefined);
  assert.equal(page["files-panel"], undefined);
  assert.equal(page["commits-panel"].hidden, false);
  const sourceFile = fileRow(page, "src/main.js");
  categoryToggle(page, "source").events.click();
  assert.equal(sourceFile.hidden, false);
  assert.equal(descendant(diffRow(page, "src/main.js"), (node) => node.tag === "a").href,
    "https://github.com/example/project/pull/1/files");
  page["commit-list"].children[1].children[0].events.click();
  assert.equal(page.scope.value, "commit:1");
  assert.equal(fileRow(page, "src/main.js"), undefined);
  const mergeFile = fileRow(page, "test/merge.test.js");
  assert.equal(mergeFile.hidden, true);
  categoryToggle(page, "test").events.click();
  assert.equal(mergeFile.hidden, false);
  assert.equal(page["commit-list"].children[1].children[0].attributes["aria-current"], "true");
  assert.equal(page["commit-list"].children[1].children[0].focused, true);
  assert.equal(descendant(diffRow(page, "test/merge.test.js"), (node) => node.tag === "a").href,
    "https://github.com/example/project/commit/merge");
  assert.equal(page["commit-link"].href, "https://github.com/example/project/commit/merge");
  assert.equal(page["commit-link"].hidden, false);
  page.scope.value = "whole";
  page.scope.events.change();
  assert.equal(page["commit-link"].hidden, true);
});

test("Multiple reports remain searchable and switching reports clears expanded groups and commit state", () => {
  const empty = createReport({
    source: { kind: "fixture", repository: "empty" }, title: "No changes",
    comparison: { mergeBaseSha: "base", headSha: "base" }, files: [],
  });
  const page = reviewPage(sample(), empty);
  assert.equal(page["report-control"].hidden, false);
  assert.equal(page["reports-panel"].hidden, false);
  categoryToggle(page, "binary").events.click();
  page.search.value = "empty";
  page.search.events.input();
  assert.equal(page["report-rows"].children.length, 0);
  assert.equal(page.empty.hidden, false);
  page.report.value = "1";
  page.report.events.change();
  assert.equal(page.report.value, "1");
  assert.equal(page.scope.value, "whole");
  assert.equal(page["role-empty"].hidden, false);
  assert.match(page["commit-list"].textContent, /No commits/);
  assert.equal(page["category-rows"].children.length, 0);
  page.search.value = "no match";
  page.search.events.input();
  assert.equal(page.empty.hidden, false);
  page.report.value = "0";
  page.report.events.change();
  assert.match(page["review-title"].textContent, /fixture/);
  assert.equal(page["role-empty"].hidden, true);
});

test("HTML embeds untrusted data without script or template injection", () => {
  const report = sample();
  const html = renderReports([report]);
  const json = html.match(/<script id="report-data"[^>]*>([\s\S]*?)<\/script>/)[1];
  assert.deepEqual(JSON.parse(json), [report]);
  assert.ok(!json.includes("<"));
  assert.ok(json.includes("__NONCE__"));
  assert.equal((html.match(/<script /g) ?? []).length, 2);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /connect-src 'self'/);
  const nonce = html.match(/script-src 'nonce-([^']+)'/)[1];
  const escapedNonce = nonce.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.equal((html.match(new RegExp(`nonce="${escapedNonce}"`, "g")) ?? []).length, 3);
  assert.throws(() => renderReports([]), /At least one/);
});

test("Stored content identity is checked before save and after load", async (t) => {
  const output = temporary(t);
  const report = sample();
  const path = await saveReport(output, report);
  assert.deepEqual(await loadReport(output, report.id), report);
  const changed = { ...report, title: "tampered" };
  await assert.rejects(saveReport(output, changed), /immutable identity/);
  writeFileSync(path, JSON.stringify(changed));
  await assert.rejects(loadReport(output, report.id), /immutable identity/);
});

test("CLI generates immutable reports and reopens multiple persisted inputs", async (t) => {
  const output = temporary(t);
  const first = sample();
  const second = createReport({
    source: { kind: "fixture", repository: "empty" }, title: "Empty scope",
    comparison: { baseSha: "base", mergeBaseSha: "base", headSha: "base" }, files: [],
  });

  const firstPath = await saveReport(join(output, "inputs"), first);
  const secondPath = await saveReport(join(output, "inputs"), second);
  run("node", [cli, "view", "--input", firstPath, "--input", secondPath, "--out", join(output, "rendered")]);
  const html = readFileSync(join(output, "rendered", "review.html"), "utf8");
  const json = html.match(/<script id="report-data"[^>]*>([\s\S]*?)<\/script>/)[1];
  assert.deepEqual(JSON.parse(json).map((report) => report.id), [first.id, second.id]);
  assert.ok(existsSync(join(output, "rendered", `${first.id}.json`)));
  assert.throws(() => run("node", [cli, "pr", "--working", "--out", output]), /not valid for pr/);
  assert.throws(() => run("node", [cli, "local", "--base", "HEAD"]), /--out is required/);
});

test("Retained corpus reports remain viewable offline with navigable real PR scopes", async (t) => {
  const output = temporary(t);
  const corpusPath = resolve("research/corpus.json");
  const reports = reportsFromCorpus(JSON.parse(readFileSync(corpusPath, "utf8")));
  await Promise.all(reports.map((report) => saveReport(output, report)));
  run("node", [cli, "view", ...reports.flatMap((report) => ["--input", join(output, `${report.id}.json`)]), "--out", output]);
  const html = readFileSync(join(output, "review.html"), "utf8");
  const embedded = JSON.parse(html.match(/<script id="report-data"[^>]*>([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(embedded, reports);
  for (const report of reports) assert.deepEqual(await loadReport(output, report.id), report);
  run("node", [cli, "view", "--input", join(output, `${reports[0].id}.json`), "--out", join(output, "reopened")]);
  const page = reviewHtml(html);
  assert.doesNotMatch(html, /table-spacer|<th[^>]*>Churn<\/th>/);
  assert.equal(page["report-rows"].children.length, 30);
  const descendants = (node) => [node, ...node.children.flatMap(descendants)];
  function assertNumericColumns() {
    assert.equal(page["bar-heading"].hidden, true);
    assert.equal(page["metric-legend"].hidden, true);
    for (const row of page["category-rows"].children) {
      if (row.className !== "diff-row") assert.equal(row.children.length, 2);
    }
    assert.equal(descendants(page["category-rows"]).some((node) => node.tag === "svg"), false);
    assert.equal(descendants(page["commit-list"]).some((node) => node.tag === "svg"), false);
  }
  for (const [index, report] of reports.entries()) {
    page.report.value = String(index);
    page.report.events.change();
    assertNumericColumns();
    for (const [commitIndex] of report.commits.entries()) {
      page.scope.value = `commit:${commitIndex}`;
      page.scope.events.change();
      assertNumericColumns();
    }
  }
  for (const repository of ["spf13/cobra", "microsoft/TypeScript", "nodejs/node", "elastic/elasticsearch"]) {
    const index = reports.findIndex((report) => report.source.repository === repository);
    page.report.value = String(index);
    page.report.events.change();
    assert.equal(page["source-link"].href, reports[index].source.url);
    const firstFile = reports[index].metrics.fileMetrics[0];
    const firstFileRow = fileRow(page, firstFile.path);
    assert.equal(fileRows(page).length, reports[index].metrics.files);
    assert.equal(firstFileRow.hidden, true);
    categoryToggle(page, firstFile.category).events.click();
    assert.equal(firstFileRow.hidden, false);
    assert.ok(descendant(diffRow(page, firstFile.path), (node) => node.tag === "a"));
  }
  const merge = reports.find((report) => report.source.repository === "elastic/elasticsearch");
  assert.equal(merge.metrics.churn, 14);
  const index = merge.commits.findIndex((commit) => commit.parentCount > 1);
  page["commit-list"].children[index].children[0].events.click();
  assert.equal(page["commit-link"].href, merge.commits[index].url);
  assert.equal(merge.commits[index].metrics.churn, 25093);
  assert.equal(fileRows(page).length, merge.commits[index].files.length);
  const firstCommitFile = merge.commits[index].metrics.fileMetrics[0];
  const firstCommitFileRow = fileRow(page, firstCommitFile.path);
  categoryToggle(page, firstCommitFile.category).events.click();
  assert.equal(firstCommitFileRow.hidden, false);
  assert.equal(descendant(diffRow(page, firstCommitFile.path), (node) => node.tag === "a").href,
    merge.commits[index].url);
  page.shape.value = "binary";
  page.shape.events.change();
  assert.equal(page.empty.hidden, false);
  for (const args of [
    [], ["--input", corpusPath, "--input", corpusPath],
  ]) {
    assert.throws(() => run("node", [cli, "corpus", ...args, "--out", output]), /exactly one --input/);
  }
  assert.throws(() => run("node", [cli, "corpus", "--input", corpusPath, "--working", "--out", output]), /not valid for corpus/);
  assert.throws(() => run("node", [cli, "view", "--input", corpusPath, "--out", output]), /immutable/);
});

test("Embedded diffs render without requests in GitHub and original-commit scopes", async () => {
  const file = {
    path: "value.js", status: "modified", additions: 1, deletions: 1, patchState: "complete",
    diff: { binary: false, diff: "@@ -1 +1 @@\n-old\n+new\n</script>" },
  };
  const report = createReport({
    source: { kind: "github", repository: "test/repo", url: "https://github.com/test/repo/pull/1" },
    title: "Inline diff", comparison: {}, files: [file],
    commits: [{ sha: "head", parentSha: "base", parentCount: 1, subject: "Change",
      url: "https://github.com/test/repo/commit/head", files: [{ ...file,
        diff: { binary: false, diff: "@@ -1 +1 @@\n-commit old\n+commit new" } }] }],
  });
  const page = reviewPage(report);
  for (const [scope, expected] of [["whole", "-old"], ["commit:0", "-commit old"]]) {
    page.scope.value = scope;
    page.scope.events.change();
    categoryToggle(page, "source").events.click();
    const details = fileRow(page, "value.js").children[0].children[0];
    details.open = true;
    details.events.toggle();
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(diffRow(page, "value.js").textContent, new RegExp(expected));
  }
  assert.deepEqual(page.fetchRequests, []);
});

test("Compact filenames retain full accessible and expanded paths without requiring text diffs", () => {
  const path = `${"directory/".repeat(40)}${"basename".repeat(40)}<unsafe>.js`;
  const report = createReport({
    source: { kind: "fixture", repository: "fixture" }, title: "Long paths", comparison: {},
    files: [
      { path, previousPath: "previous/<unsafe>.js", status: "renamed", additions: 0, deletions: 0 },
      { path: "assets/logo.bin", status: "modified", binary: true, additions: 0, deletions: 0,
        beforeBytes: 4, afterBytes: 9 },
      { path: "README.md", status: "modified", additions: 1, deletions: 1 },
    ],
  });
  const page = reviewPage(report);
  categoryToggle(page, "source").events.click();
  const details = fileRow(page, path).children[0].children[0], summary = details.children[0];
  assert.equal(summary.attributes["aria-label"], `${path} (renamed)`);
  const name = descendant(summary, (node) => node.className === "file-name");
  assert.equal(name.textContent, path);
  assert.equal(name.children[0].className, "path-prefix");
  assert.equal(name.children[1].className, "path-suffix");
  assert.equal(name.children[1].children[0].attributes.dir, "ltr");
  assert.equal(diffRow(page, path).hidden, true);
  details.open = true;
  details.events.toggle();
  assert.equal(diffRow(page, path).hidden, false);
  assert.equal(descendant(diffRow(page, path), (node) => node.className === "full-path").textContent, path);
  assert.match(diffRow(page, path).textContent, /Previous path: previous\/<unsafe>.js/);
  assert.match(diffRow(page, path).textContent, /Diff not included/);
  assert.match(diffRow(page, "assets/logo.bin").textContent, /Binary file; no text diff/);
  assert.match(diffRow(page, "README.md").textContent, /Diff not included/);
  assert.equal(descendant(diffRow(page, path), (node) => node.tag === "input"), undefined);
  categoryToggle(page, "source").events.click();
  assert.equal(diffRow(page, path).hidden, true);
  categoryToggle(page, "source").events.click();
  assert.equal(diffRow(page, path).hidden, false);
  assert.deepEqual(page.fetchRequests, []);
});

test("Wrapping preserves exact patch text and synchronizes current and newly opened diffs across selections", async () => {
  const patch = `@@ -1 +1 @@\n-${"old".repeat(100)}\n+\t<unsafe>${"new".repeat(100)}`;
  const file = (path, diff = patch) => ({ ...metricFile(path, "old\n", "new\n"), diff: { diff } });
  const first = createReport({
    source: { kind: "fixture", repository: "fixture" }, title: "Wrap first", comparison: {},
    files: [file("first.js"), file("second.js", `${patch}\n`)],
    commits: [{ sha: "head", parentSha: "base", parentCount: 1, subject: "Change", files: [file("first.js")] }],
  });
  const second = createReport({
    source: first.source, title: "Wrap second", comparison: {}, files: [file("first.js")],
  });
  const page = reviewPage(first, second);
  const open = async (path) => {
    const row = fileRow(page, path);
    if (row.hidden) categoryToggle(page, row.dataset.category).events.click();
    const details = row.children[0].children[0];
    details.open = true;
    details.events.toggle();
    await new Promise((resolve) => setImmediate(resolve));
    const output = descendant(diffRow(page, path), (node) => node.tag === "pre");
    const input = descendant(diffRow(page, path), (node) => node.tag === "input");
    assert.equal(output.attributes["aria-busy"], "false");
    assert.equal(output.attributes.tabindex, "0");
    assert.equal(descendant(diffRow(page, path), (node) => node.className === "full-path"), undefined);
    return { output, input };
  };
  const a = await open("first.js"), b = await open("second.js");
  assert.equal(a.input.checked, false);
  assert.equal(a.output.dataset.wrap, "false");
  a.input.checked = true;
  a.input.events.change();
  assert.equal(a.output.textContent, patch);
  assert.equal(b.output.textContent, `${patch}\n`);
  assert.equal(a.output.dataset.wrap, "true");
  assert.equal(b.output.dataset.wrap, "true");
  assert.equal(b.input.checked, true);
  for (const [control, value] of [["metric", "bytes"], ["scope", "commit:0"], ["report", "1"]]) {
    page[control].value = value;
    page[control].events.change();
    const next = await open("first.js");
    assert.equal(next.input.checked, true);
    assert.equal(next.output.dataset.wrap, "true");
    assert.equal(next.output.textContent, patch);
  }
  assert.deepEqual(page.fetchRequests, []);
});

test("Rows omit modified labels and zero binary totals without hiding exceptional statuses or binary evidence", () => {
  const report = createReport({
    source: { kind: "fixture", repository: "fixture" }, title: "Less noise", comparison: {},
    files: [
      { path: "src/modified.js", status: "modified", additions: 2, deletions: 1 },
      { path: "src/added.js", status: "added", additions: 1, deletions: 0 },
      { path: "src/old.js", status: "removed", additions: 0, deletions: 1 },
      { path: "src/renamed.js", previousPath: "src/before.js", status: "renamed", additions: 0, deletions: 0 },
    ],
  });
  const page = reviewPage(report);
  assert.doesNotMatch(page.totals.textContent, /binary files/);
  assert.equal(page.totals.children.length, 2);
  assert.equal(descendant(fileRow(page, "src/modified.js"), (node) => node.className === "file-meta"), undefined);
  for (const [path, status] of [["src/added.js", "added"], ["src/old.js", "removed"], ["src/renamed.js", "renamed"]]) {
    assert.equal(descendant(fileRow(page, path), (node) => node.className === "file-meta").textContent, status);
  }
  assert.match(reviewPage(sample()).totals.textContent, /1binary files/);
});

test("Middle path truncation preserves combining characters and joined emoji", () => {
  const paths = ["ab\u0301", "a👩🏽‍💻"];
  const page = reviewPage(createReport({
    source: { kind: "fixture", repository: "fixture" }, title: "Unicode paths", comparison: {},
    files: paths.map((path) => ({ path, status: "modified", additions: 1, deletions: 1 })),
  }));
  for (const path of paths) {
    const name = descendant(fileRow(page, path), (node) => node.className === "file-name");
    assert.equal(name.children[0].textContent, "a");
    assert.equal(name.children[1].textContent, path.slice(1));
  }
});

test("Table resizing updates middle truncation without retaining measurement cells or stale rows", () => {
  const path = "directory/subdirectory/long-filename.js";
  const page = reviewPage(createReport({
    source: { kind: "fixture", repository: "fixture" }, title: "Resize paths", comparison: {},
    files: [{ path, status: "modified", additions: 1, deletions: 1 }],
  }));
  categoryToggle(page, "source").events.click();
  const name = descendant(fileRow(page, path), (node) => node.className === "file-name");
  const observer = page.resizeObservers[0];
  assert.ok(observer.observed.has(page["footprint-table"]));
  for (const part of name.children) part.firstElementChild.getBoundingClientRect = () => ({ width: 100 });
  for (const [width, truncated] of [[150, "true"], [201, "false"], [199, "true"], [400, "false"]]) {
    name.clientWidth = width;
    observer.callback();
    assert.equal(name.dataset.truncated, truncated);
    assert.equal(name.textContent, path);
    assert.equal(fileRow(page, path).children.length, 2);
  }
  page.scope.events.change();
  name.clientWidth = 0;
  observer.callback();
  assert.equal(name.dataset.truncated, "false");
  assert.ok(observer.observed.has(page["footprint-table"]));
});
