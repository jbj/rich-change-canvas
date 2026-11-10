import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createReport, loadReport, saveReport } from "../src/report.mjs";
import { renderReports } from "../src/render.mjs";
import { run } from "../src/process.mjs";
import { runInNewContext } from "node:vm";

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

function reviewPage(report) {
  class Element {
    children = [];
    value = "";
    hidden = false;
    dataset = {};
    events = {};
    constructor(tag, text = "") { this.tag = tag; this.text = text; }
    get textContent() { return this.text + this.children.map((child) => child.textContent).join(""); }
    set textContent(value) { this.text = value; this.children = []; }
    get childElementCount() { return this.children.length; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    addEventListener(name, handler) { this.events[name] = handler; }
    setAttribute() {}
    removeAttribute() {}
  }
  const ids = [...readFileSync(new URL("../web/review.html", import.meta.url), "utf8").matchAll(/id="([^"]+)"/g)];
  const nodes = Object.fromEntries(ids.map(([, id]) => [id, Object.assign(new Element("div"), { id })]));
  const tabs = ["desk", "receipt", "history"].map((id) => {
    const node = nodes[`tab-${id}`];
    node.dataset.view = id;
    return node;
  });
  nodes["report-data"].textContent = JSON.stringify([report]);
  const document = {
    getElementById: (id) => nodes[id],
    createElement: (tag) => new Element(tag),
    createTextNode: (text) => new Element("#text", text),
    querySelectorAll: (selector) => selector === "[data-view]" ? tabs :
      ["desk", "receipt", "history"].map((id) => nodes[id]),
  };
  runInNewContext(readFileSync(new URL("../web/review.js", import.meta.url), "utf8"), { document, URL });
  assert.equal(nodes.error.textContent, "");
  return nodes;
}

test("Review desk exposes each local layer and opens its own file receipts", () => {
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
  assert.equal(page.receipt.hidden, false);
  assert.match(page["file-list"].textContent, /test\/local.test.js/);
  assert.doesNotMatch(page["file-list"].textContent, /src\/staged.js/);
  page.shape.value = "binary";
  page.shape.events.change();
  assert.equal(page["report-rows"].children.length, 1);
  assert.match(page["report-rows"].textContent, /Untracked/);
});

test("Review desk preserves committed-only reports without local rows", () => {
  const page = reviewPage(sample());
  assert.equal(page["report-rows"].children.length, 1);
  assert.equal(page.scope.value, "whole");
  assert.equal(page["report-rows"].children[0].children[5].textContent, "1");
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
