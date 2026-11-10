import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createReport, loadReport, saveReport } from "../src/report.mjs";
import { renderReports } from "../src/render.mjs";
import { run } from "../src/process.mjs";

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
  assert.equal((html.match(new RegExp(`nonce="${nonce}"`, "g")) ?? []).length, 3);
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
