import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function inspectTableLayout(table) {
  const win = table.ownerDocument.defaultView;
  const rows = [...table.querySelectorAll("thead tr, .category-row, .file-row:not([hidden])")];
  const widths = [...rows[0].cells].map((cell) => cell.hidden ? 0 : cell.getBoundingClientRect().width);
  const available = table.clientWidth, preferred = [0, 0, 0], minimum = [0, 0, 0], probes = [], problems = [];
  const segments = new win.Intl.Segmenter(undefined, { granularity: "grapheme" });
  try {
    for (const row of rows) for (const [index, cell] of [...row.cells].entries()) {
      if (cell.hidden) continue;
      if (Math.abs(cell.getBoundingClientRect().width - widths[index]) > 1.5) problems.push(`Column ${index} is not shared across rows`);
      const probe = cell.cloneNode(true);
      probe.removeAttribute("id");
      probe.className = `${cell.className} column-probe`;
      probe.setAttribute("aria-hidden", "true");
      probe.inert = true;
      row.append(probe);
      probes.push({ index, probe });
    }
    for (const { index, probe } of probes) preferred[index] = Math.max(preferred[index], Math.ceil(probe.getBoundingClientRect().width));
    for (const { index, probe } of probes) {
      if (index === 0) {
        const label = probe.querySelector(".file-name") ?? probe.querySelector("button") ?? probe;
        const text = Array.from(segments.segment(label.textContent), ({ segment }) => segment);
        if (text.length > 10) label.textContent = label.matches(".file-name") ?
          `${text.slice(0, 5).join("")}...${text.slice(-5).join("")}` : text.slice(0, 10).join("");
      } else if (index === 1) {
        (probe.querySelector(".count") ?? probe).textContent = "0";
      }
    }
    for (const { index, probe } of probes) minimum[index] = Math.max(minimum[index], Math.ceil(probe.getBoundingClientRect().width));
  } finally {
    for (const { probe } of probes) probe.remove();
  }
  const natural = preferred.reduce((sum, width) => sum + width, 0);
  const trailing = available - widths.reduce((sum, width) => sum + width, 0);
  if (natural <= available) {
    if (widths.some((width, index) => Math.abs(width - preferred[index]) > 1.5)) {
      problems.push("Fitting columns are not packed at their intrinsic widths");
    }
  } else {
    if (Math.abs(trailing) > 1.5) problems.push(`Compressed columns leave ${Math.round(trailing)}px on the right`);
    if (widths.slice(1).some((width, index) => width < preferred[index + 1] - 1.5) && widths[0] > minimum[0] + 1.5) {
      problems.push("Stats shrink before the filename column reaches its minimum");
    }
    if (minimum.reduce((sum, width) => sum + width, 0) <= available &&
        widths.some((width, index) => width < minimum[index] - 1.5)) {
      problems.push("A column is smaller than its minimum although the minimums fit");
    }
  }
  for (const row of rows) for (const cell of [...row.cells].slice(1)) {
    if (cell.hidden) continue;
    const value = cell.querySelector(".count") ?? cell.querySelector("svg");
    if (!value) continue;
    const range = table.ownerDocument.createRange();
    range.selectNodeContents(value);
    const right = value.tagName.toLowerCase() === "svg" ? value.getBoundingClientRect().right : range.getBoundingClientRect().right;
    if (Math.abs(right - cell.getBoundingClientRect().right + parseFloat(win.getComputedStyle(cell).paddingRight)) > 1.5) {
      problems.push("Stats content is not right-aligned");
    }
  }
  return { available, preferred, minimum, widths, trailing, problems: [...new Set(problems)] };
}

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
    let previous, stableFrames = 0;
    for (let attempt = 0; attempt < 12; attempt++) {
      await paint();
      const table = get("footprint-table");
      const current = [doc.documentElement.clientWidth, doc.documentElement.scrollHeight,
        table.clientWidth, table.getAttribute("style")].join("|");
      stableFrames = current === previous ? stableFrames + 1 : 0;
      if (stableFrames === 2) return;
      previous = current;
    }
    throw new Error("Table layout did not settle after resizing");
  };
  const fail = (context, problem) => result.failures.push({ ...context, problem });
  const check = (context) => {
    const error = get("error");
    if (error.textContent || !error.hidden) fail(context, `Render error: ${error.textContent}`);
    const overflow = doc.documentElement.scrollWidth - doc.documentElement.clientWidth;
    if (overflow > 1) fail(context, `Document overflows by ${overflow}px`);
    for (const problem of inspectTableLayout(get("footprint-table")).problems) fail(context, problem);
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
      await settle();
      const collapsed = inspectTableLayout(get("footprint-table")).widths;
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
      for (const button of doc.querySelectorAll('.role-name[aria-expanded="true"]')) button.click();
      await settle();
      check({ ...context, visibility: "collapsed" });
      if (inspectTableLayout(get("footprint-table")).widths.some((width, index) => Math.abs(width - collapsed[index]) > 1.5)) {
        fail(context, "Collapsing roles does not restore visible-only column widths");
      }
      for (const button of doc.querySelectorAll(".role-name")) button.click();
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
  const inspectTableLayout = ${inspectTableLayout.toString()};
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
