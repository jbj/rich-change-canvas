import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function auditReview(frame, widths = [480, 640, 800, 1024, 1280]) {
  const win = frame.contentWindow, doc = frame.contentDocument;
  const get = (id) => doc.getElementById(id);
  const reports = JSON.parse(get("report-data").textContent);
  const result = { reports: reports.length, widths, metricChecks: 0, scopeChecks: 0, diffChecks: 0, failures: [] };
  const select = (id, value) => {
    get(id).value = String(value);
    get(id).dispatchEvent(new win.Event("change"));
  };
  const paint = () => new Promise((resolve) => win.requestAnimationFrame(resolve));
  const settle = async () => {
    await paint();
    await paint();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  const fail = (context, problem) => result.failures.push({ ...context, problem });
  const check = (context) => {
    const error = get("error");
    if (error.textContent || !error.hidden) fail(context, `Render error: ${error.textContent}`);
    const overflow = doc.documentElement.scrollWidth - doc.documentElement.clientWidth;
    if (overflow > 1) fail(context, `Document overflows by ${overflow}px`);
    for (const cell of doc.querySelectorAll(".category-row td:nth-child(2), .file-row:not([hidden]) td:nth-child(2)")) {
      if (cell.scrollWidth > cell.clientWidth + 1) {
        fail(context, `Metric cell overflows: ${cell.textContent}`);
        break;
      }
    }
    for (const row of doc.querySelectorAll(".file-row:not([hidden])")) {
      const name = row.querySelector(".file-name"), value = row.cells[1].querySelector(".count");
      if (!name || !value) continue;
      const parts = [...name.children];
      const pathWidth = parts.reduce((sum, part) => sum + part.firstElementChild.getBoundingClientRect().width, 0);
      const clipped = pathWidth > name.clientWidth + 0.5;
      if (clipped && win.getComputedStyle(name, "::after").content !== '"..."') {
        fail(context, `Truncated path has no middle ellipsis: ${row.dataset.filePath}`);
      }
      const suffix = name.querySelector(".path-suffix");
      if (suffix?.firstElementChild.getBoundingClientRect().right > suffix.getBoundingClientRect().right + 1.5) {
        fail(context, `Path suffix is clipped at its right end: ${row.dataset.filePath}`);
      }
      const range = doc.createRange();
      range.selectNodeContents(value);
      const bounds = range.getBoundingClientRect(), style = win.getComputedStyle(row.cells[1]);
      const valueSlack = row.cells[1].clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - bounds.width;
      if (clipped && valueSlack > 12) fail(context, `Truncated path has ${Math.round(valueSlack)}px unused in its metric cell`);
      const nameSlack = name.clientWidth - parts.reduce((sum, part) => sum + part.getBoundingClientRect().width, 0);
      if (bounds.height > parseFloat(win.getComputedStyle(value).lineHeight) + 2 && !clipped && nameSlack > 12) {
        fail(context, `Wrapped metric has ${Math.round(nameSlack)}px unused beside its path`);
      }
    }
  };
  const waitForDiff = (output) => new Promise((resolve, reject) => {
    const observer = new win.MutationObserver(() => {
      if (output.getAttribute("aria-busy") === "false") {
        clearTimeout(timeout);
        observer.disconnect();
        resolve();
      }
    });
    const timeout = setTimeout(() => {
      observer.disconnect();
      reject(new Error("Diff did not finish loading"));
    }, 20000);
    observer.observe(output, { attributes: true, attributeFilter: ["aria-busy"] });
    if (output.getAttribute("aria-busy") === "false") {
      clearTimeout(timeout);
      observer.disconnect();
      resolve();
    }
  });
  for (const width of widths) {
    frame.width = String(width);
    await paint();
    for (const [index, report] of reports.entries()) {
      select("metric", "lines");
      select("report", index);
      get("reports-panel").open = !get("reports-panel").hidden;
      get("commits-panel").open = true;
      const context = { width, report: index, repository: report.source.repository };
      for (const option of [...get("scope").options]) {
        select("scope", option.value);
        await settle();
        result.scopeChecks++;
        check({ ...context, scope: option.value });
      }
      select("scope", "whole");
      for (const button of doc.querySelectorAll(".role-name")) button.click();
      for (const row of doc.querySelectorAll(".file-row")) {
        const path = row.dataset.filePath;
        if (!row.querySelector("summary").getAttribute("aria-label")?.includes(path) ||
            row.querySelector(".file-name")?.textContent !== path) {
          fail(context, `Full path unavailable: ${path}`);
        }
      }
      for (const option of [...get("metric").options]) {
        select("metric", option.value);
        await settle();
        result.metricChecks++;
        check({ ...context, metric: option.value });
      }
      select("metric", "lines");
      let candidate;
      for (const file of report.metrics.fileMetrics) {
        if (!file.diff?.diff || (!file.additions && !file.deletions)) continue;
        let longest = 0;
        for (const line of file.diff.diff.split("\n")) longest = Math.max(longest, line.length);
        if (!candidate || longest > candidate.longest) candidate = { file, longest };
      }
      if (!candidate) continue;
      const row = [...doc.querySelectorAll(".file-row")].find((row) => row.dataset.filePath === candidate.file.path);
      if (!row) {
        fail(context, "Longest-line file was not rendered");
        continue;
      }
      const details = row.querySelector("details");
      const toggled = new Promise((resolve) => details.addEventListener("toggle", resolve, { once: true }));
      details.open = true;
      await toggled;
      const detailRow = row.nextElementSibling, output = detailRow.querySelector(".diff-content");
      if (!output) {
        fail(context, "Opening file did not create its diff region");
        continue;
      }
      await waitForDiff(output);
      if (detailRow.hidden) fail(context, "Expanded diff is not visible");
      if (detailRow.querySelector(".full-path")) {
        fail(context, "Text diff repeats its file path above or below the patch");
      }
      const checkbox = detailRow.querySelector(".wrap-control input");
      if (!checkbox) {
        fail(context, `Text diff has no wrapping control: ${output.textContent.slice(0, 100)}`);
        continue;
      }
      for (const wrapped of [false, true]) {
        checkbox.checked = wrapped;
        checkbox.dispatchEvent(new win.Event("change"));
        await settle();
        result.diffChecks++;
        const detailContext = { ...context, path: candidate.file.path, wrapped };
        check(detailContext);
        if (output.textContent !== candidate.file.diff.diff) fail(detailContext, "Patch text changed");
        if (output.getAttribute("tabindex") !== "0") fail(detailContext, "Diff is not keyboard focusable");
        if (output.getBoundingClientRect().right > doc.documentElement.clientWidth + 1) {
          fail(detailContext, "Diff extends beyond viewport");
        }
        if (wrapped && output.scrollWidth > output.clientWidth + 1) fail(detailContext, "Wrapped diff still scrolls horizontally");
      }
    }
  }
  return result;
}

function harness(nonce) {
  return `<!doctype html>
<html lang="en"><meta charset="utf-8"><title>Review browser audit</title>
<style nonce="${nonce}">
  body { margin: 0; font: 13px system-ui; color: #1f2328; background: #d1d9e0; }
  header { padding: 8px; display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
  iframe { display: block; border: 0; height: 900px; background: white; }
  pre { margin: 0; padding: 8px; white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
<header>
  <label>Viewport <select id="width">${[480, 640, 800, 1024, 1280].map((width) =>
    `<option${width === 1280 ? " selected" : ""}>${width}</option>`).join("")}</select> CSS px</label>
  <button id="audit" disabled>Audit all reports</button>
  <span id="status" role="status">Loading report</span>
</header>
<iframe id="preview" title="Change review viewport" src="/review.html" width="1280"></iframe>
<details><summary>Audit result (copy JSON to an external artifact)</summary><pre id="result"></pre></details>
<script nonce="${nonce}">
  const frame = document.getElementById("preview"), button = document.getElementById("audit");
  const width = document.getElementById("width"), status = document.getElementById("status");
  const audit = ${auditReview.toString()};
  width.addEventListener("change", () => { frame.width = width.value; });
  frame.addEventListener("load", () => { button.disabled = false; status.textContent = "Ready"; });
  button.addEventListener("click", async () => {
    button.disabled = width.disabled = true;
    status.textContent = "Auditing all reports, scopes, metrics and diff-wrap states";
    try {
      const result = await audit(frame);
      document.getElementById("result").textContent = JSON.stringify(result, null, 2);
      status.textContent = result.failures.length ? result.failures.length + " failures" : "Passed";
    } catch (error) {
      status.textContent = "Audit failed: " + error.message;
      document.getElementById("result").textContent = error.stack;
    } finally {
      frame.width = width.value;
      button.disabled = width.disabled = false;
    }
  });
</script></html>`;
}

export async function startBrowserReview(input) {
  const report = await readFile(input);
  const nonce = randomBytes(18).toString("base64"), page = harness(nonce);
  const server = createServer((request, response) => {
    const host = `127.0.0.1:${server.address().port}`;
    if (request.headers.host !== host || request.method !== "GET" || !["/", "/review.html"].includes(request.url)) {
      response.writeHead(404);
      response.end();
      return;
    }
    const headers = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
    if (request.url === "/") {
      headers["Content-Security-Policy"] = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; frame-src 'self'; base-uri 'none'; form-action 'none'`;
    }
    response.writeHead(200, headers);
    response.end(request.url === "/" ? page : report);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new Error("Usage: node research/browser-review.mjs /absolute/path/to/review.html");
    const { url } = await startBrowserReview(resolve(process.argv[2]));
    console.log(url);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
