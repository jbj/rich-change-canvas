import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createReport, loadReport, saveReport } from "../src/report.mjs";
import { renderReports } from "../src/render.mjs";
import { run } from "../src/process.mjs";
import { runInNewContext } from "node:vm";
import { reportsFromCorpus } from "../src/corpus.mjs";

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
  class Element {
    children = [];
    value = "";
    hidden = false;
    open = false;
    dataset = {};
    events = {};
    attributes = {};
    constructor(tag, text = "") { this.tag = tag; this.text = text; }
    get textContent() { return this.text + this.children.map((child) => child.textContent).join(""); }
    set textContent(value) { this.text = value; this.children = []; }
    get childElementCount() { return this.children.length; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    addEventListener(name, handler) { this.events[name] = handler; }
    focus() { this.focused = true; }
    setAttribute(name, value) { this.attributes[name] = value; }
    removeAttribute(name) { delete this.attributes[name]; }
  }
  const ids = [...readFileSync(new URL("../web/review.html", import.meta.url), "utf8")
    .matchAll(/<([a-z][\w-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/g)];
  const nodes = Object.fromEntries(ids.map(([, tag, attributes, id]) => [
    id, Object.assign(new Element(tag), { id, hidden: /\bhidden\b/.test(attributes), open: /\bopen\b/.test(attributes) }),
  ]));
  nodes["report-data"].textContent = JSON.stringify(reports);
  const document = {
    getElementById: (id) => nodes[id],
    createElement: (tag) => new Element(tag),
    createElementNS: (namespace, tag) => new Element(tag),
    createTextNode: (text) => new Element("#text", text),
  };
  runInNewContext(readFileSync(new URL("../web/review.js", import.meta.url), "utf8"), { document, URL });
  assert.equal(nodes.error.textContent, "");
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
function fileRows(page) {
  return page["category-rows"].children.filter((row) => row.className === "file-row");
}

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
  assert.equal(rows.length, 4);
  assert.equal(rows[0].children[1].textContent, "+0 / -0");
  assert.equal(rows[1].children[1].textContent, "+2 / -0");
  assert.equal(rows[2].children[2].textContent, "+3 / -0");
  assert.equal(rows[3].children[5].textContent, "1");
  assert.equal(page.scope.value, "index");
  rows[2].children[0].children[0].events.click();
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
  assert.match(page.totals.textContent, /\+0 \/ -0/);
  assert.equal(page.totals.children.length, 3);
  assert.doesNotMatch(page.totals.textContent, /largest file/i);
  assert.match(categoryRow(page, "binary").textContent, /4 → 9 B/);
  assert.equal(fileRow(page, "asset.bin").hidden, true);
  assert.equal(fileRow(page, "asset.bin").children[0].children[0].children.some((child) => child.tag === "a"), false);
});

test("Role bars share a text-line scale with expandable file rows", () => {
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
  assert.equal(source.children[2].children[0].attributes["aria-label"], "Source: +30 / -10 text lines; logarithmic scale 0–40");
  assert.equal(page["line-scale"].textContent, "Log scale · max 40 lines · binary: bytes");
  assert.deepEqual(source.children[2].children[0].children.map((rect) => rect.attributes.width), ["100", "75", "25"]);
  const testBarWidths = tests.children[2].children[0].children.map((rect) => Number(rect.attributes.width));
  assert.equal(testBarWidths[0], 100);
  assert.ok(Math.abs(testBarWidths[1] + testBarWidths[2] - Math.log1p(10) / Math.log1p(40) * 100) < 0.01);
  assert.deepEqual(docs.children[2].children[0].children.map((rect) => rect.attributes.width), ["100", "0", "0"]);
  assert.equal(page["evidence-panel"], undefined);
  assert.equal(page["provenance-panel"], undefined);
  const testFile = fileRow(page, "test/main.test.js");
  const docFile = fileRow(page, "docs/new.md");
  assert.equal(testFile.hidden, true);
  assert.equal(categoryToggle(page, "test").attributes["aria-expanded"], "false");
  categoryToggle(page, "test").events.click();
  assert.equal(testFile.hidden, false);
  assert.equal(categoryToggle(page, "test").attributes["aria-expanded"], "true");
  assert.equal(fileRow(page, "src/main.js").hidden, true);
  categoryToggle(page, "documentation").events.click();
  assert.equal(docFile.hidden, false);
  assert.match(docFile.textContent, /Previous path: docs\/old.md/);
  categoryToggle(page, "documentation").events.click();
  assert.equal(docFile.hidden, true);
  assert.equal(testFile.hidden, false);
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
  assert.equal(sourceFile.children[0].children[0].children.find((child) => child.tag === "a").href,
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
  assert.equal(mergeFile.children[0].children[0].children.find((child) => child.tag === "a").href,
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
  assert.equal(page["report-rows"].children.length, 1);
  page["report-rows"].children[0].children[0].children[0].events.click();
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

test("Corpus CLI creates an offline gallery reusable by view, with navigable real PR scopes", async (t) => {
  const output = temporary(t);
  const corpusPath = resolve("research/corpus.json");
  const reports = reportsFromCorpus(JSON.parse(readFileSync(corpusPath, "utf8")));
  run("node", [cli, "corpus", "--input", corpusPath, "--out", output]);
  const html = readFileSync(join(output, "review.html"), "utf8");
  const embedded = JSON.parse(html.match(/<script id="report-data"[^>]*>([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(embedded, reports);
  for (const report of reports) assert.deepEqual(await loadReport(output, report.id), report);
  run("node", [cli, "view", "--input", join(output, `${reports[0].id}.json`), "--out", join(output, "reopened")]);
  const page = reviewPage(...embedded);
  assert.equal(page["report-rows"].children.length, 30);
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
    assert.equal(firstFileRow.children[0].children[0].children.some((child) => child.tag === "a"), true);
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
  assert.equal(firstCommitFileRow.children[0].children[0].children.find((child) => child.tag === "a").href,
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
