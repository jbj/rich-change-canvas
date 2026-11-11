import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { get } from "node:http";
import { startBrowserReview } from "../research/browser-review.mjs";

test("Browser helper serves only the explicit report and isolated harness on loopback", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "rich-browser-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = join(root, "review.html");
  const html = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'"><p>Report</p>';
  await writeFile(input, html);
  const { server, url } = await startBrowserReview(input);
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  assert.equal(server.address().address, "127.0.0.1");
  const report = await fetch(`${url}review.html`);
  assert.equal(await report.text(), html);
  assert.equal(report.headers.get("cache-control"), "no-store");
  const harness = await fetch(url);
  assert.match(harness.headers.get("content-security-policy"), /frame-src 'self'/);
  assert.match(await harness.text(), /Audit all reports/);
  for (const path of ["review.html?path=secret", "unknown", "%2e%2e/secret", "diff?path=secret"]) {
    assert.equal((await fetch(`${url}${path}`)).status, 404);
  }
  assert.equal((await fetch(url, { method: "POST" })).status, 404);
  const untrustedHostStatus = await new Promise((resolve, reject) => {
    get(url, { headers: { Host: "untrusted.example" } }, (response) => {
      response.resume();
      resolve(response.statusCode);
    }).on("error", reject);
  });
  assert.equal(untrustedHostStatus, 404);
});

test("Browser helper reports missing input instead of starting an empty preview", async () => {
  await assert.rejects(startBrowserReview(join(tmpdir(), "missing-rich-review", "review.html")), /ENOENT/);
});
