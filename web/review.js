"use strict";
(() => {
  const $ = (id) => document.getElementById(id);
  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const roles = {
    source: "Source", test: "Test harness", "test-support": "Test support",
    fixture: "Test inputs", snapshot: "Snapshots", documentation: "Documentation",
    manifest: "Build / dependencies", lockfile: "Lockfiles", generated: "Generated convention",
    configuration: "Configuration", binary: "Binary assets", other: "Other / inspect",
  };
  const count = (metric) => `+${metric.additions} / -${metric.deletions}`;
  const link = (node, url) => {
    node.hidden = true;
    node.removeAttribute("href");
    if (!url) return;
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return;
    node.href = parsed.href;
    node.hidden = false;
  };
  try {
    const reports = JSON.parse($("report-data").textContent);
    if (!Array.isArray(reports) || !reports.length) throw new Error("No reports were provided");
    let category = null;
    const selected = () => reports[Number($("report").value)];
    const scope = () => {
      const report = selected();
      const key = $("scope").value;
      if (key === "whole") return { title: "Whole change: merge base to head", metrics: report.metrics,
        before: report.comparison.mergeBaseSha, after: report.comparison.headSha };
      if (key.startsWith("commit:")) {
        const commit = report.commits[Number(key.slice(7))];
        return { title: `${commit.parentCount > 1 ? "Merge context" : "Commit"}: ${commit.subject}`,
          metrics: commit.metrics, before: commit.parentSha, after: commit.sha, url: commit.url };
      }
      const layer = report.layers.find((item) => item.id === key);
      if (!layer) throw new Error("Selected scope is unavailable");
      return { title: layer.title, metrics: layer.metrics,
        before: "Mutable local snapshot", after: report.comparison.mutableContentHash };
    };
    function show(view) {
      for (const button of document.querySelectorAll("[data-view]")) {
        button.setAttribute("aria-selected", String(button.dataset.view === view));
        button.tabIndex = button.dataset.view === view ? 0 : -1;
      }
      for (const panel of document.querySelectorAll("[role=tabpanel]")) panel.hidden = panel.id !== view;
      $("selection").hidden = view === "desk";
    }
    const buttons = [...document.querySelectorAll("[data-view]")];
    for (const [index, button] of buttons.entries()) {
      button.addEventListener("click", () => show(button.dataset.view));
      button.addEventListener("keydown", (event) => {
        const target = event.key === "ArrowRight" ? (index + 1) % buttons.length :
          event.key === "ArrowLeft" ? (index + buttons.length - 1) % buttons.length :
          event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : null;
        if (target === null) return;
        event.preventDefault();
        show(buttons[target].dataset.view);
        buttons[target].focus();
      });
    }
    function cards(items) {
      $("totals").replaceChildren();
      for (const [value, title] of items) {
        const card = el("div", undefined, "card");
        card.append(el("div", String(value), "num"), el("h3", title));
        $("totals").append(card);
      }
    }
    function fileReceipts(metrics) {
      $("files-heading").textContent = category ? `File receipts: ${roles[category]}` : "File receipts";
      $("clear-category").hidden = category === null;
      $("file-list").replaceChildren();
      for (const file of metrics.fileMetrics.filter((item) => !category || item.category === category)) {
        const details = el("details");
        const summary = el("summary");
        summary.append(el("code", file.path), document.createTextNode(` / ${roles[file.category]} / ${
          file.binary ? `before ${file.beforeBytes ?? 0} bytes -> after ${file.afterBytes ?? 0} bytes` : count(file)
        }`));
        details.append(summary, el("p", `${file.status}; ${file.patchState}; ${file.reason}`, "muted"));
        if (file.previousPath) details.append(el("p", `Previous path: ${file.previousPath}`));
        $("file-list").append(details);
      }
    }
    function render() {
      const report = selected();
      const current = scope();
      const metrics = current.metrics;
      $("receipt-title").textContent = current.title;
      $("comparison").replaceChildren(el("strong", current.title),
        el("div", `${current.before ?? "empty tree"} -> ${current.after}`),
        el("small", `Report ${report.id} / ${report.analyzerVersion}`));
      link($("commit-link"), current.url);
      cards([[metrics.files, "Changed files"], [count(metrics), "Text lines"],
        [metrics.largestFileChurn, "Largest file: changed lines"], [metrics.binaryFiles, "Binary files"]]);
      $("category-rows").replaceChildren();
      for (const [key, metric] of Object.entries(metrics.categories)) {
        const row = el("tr"), name = el("td"), button = el("button", roles[key]);
        button.addEventListener("click", () => { category = key; fileReceipts(metrics); });
        name.append(button);
        row.append(name, el("td", String(metric.files)),
          el("td", key === "binary" ? `before: ${metric.beforeBytes} bytes` : `+${metric.additions}`, "count"),
          el("td", key === "binary" ? `after: ${metric.afterBytes} bytes` : `-${metric.deletions}`, "count"));
        $("category-rows").append(row);
      }
      $("evidence").replaceChildren(
        el("p", `${metrics.incomplete} incomplete text patches in this scope.`),
        el("p", `Semantic analysis unavailable: ${report.structuralAnalysis.reason}`, "muted"),
        el("p", "No separate test-file delta does not mean no tests. Counts are not coverage, correctness, or an approval recommendation.", "muted"));
      if (report.source.state) $("evidence").append(el("p", `PR state: ${report.source.state}`));
      if (report.source.discussion) $("evidence").append(
        el("p", `${report.source.discussion.issueComments} issue comments; ${report.source.discussion.inlineComments} inline comments.`),
        el("p", report.source.discussion.note, "muted"));
      for (const warning of report.warnings) $("evidence").append(el("p", warning, "muted"));
      $("observations").replaceChildren();
      for (const observation of metrics.observations) $("observations").append(el("p", observation, "note"));
      fileReceipts(metrics);
      $("commit-list").replaceChildren();
      for (const [index, commit] of report.commits.entries()) {
        const item = el("div", undefined, "commit");
        const button = el("button", `${index + 1}. ${commit.sha.slice(0, 10)} ${commit.subject}`);
        button.addEventListener("click", () => { $("scope").value = `commit:${index}`; category = null; render(); show("receipt"); });
        item.append(button, el("p", `${commit.parentCount > 1 ? `Merge context (${commit.parentCount} parents)` : "Ordinary commit"} / ${count(commit.metrics)} / ${commit.metrics.files} files`));
        $("commit-list").append(item);
      }
      if (!report.commits.length) $("commit-list").append(el("p", "No commits between the merge base and HEAD.", "muted"));
      const ordinary = report.commits.filter((commit) => commit.parentCount < 2)
        .reduce((sum, commit) => sum + commit.metrics.churn, 0);
      const merges = report.commits.filter((commit) => commit.parentCount > 1)
        .reduce((sum, commit) => sum + commit.metrics.churn, 0);
      $("history-totals").replaceChildren(
        el("p", `Final change: ${report.metrics.churn} changed text lines in ${report.metrics.files} files.`),
        el("p", `Ordinary commit churn: ${ordinary} lines. Merge-context churn: ${merges} lines.`),
        el("p", "These are different comparisons, not additive measures of the final change or of wasted effort.", "muted"));
    }
    function load(key) {
      category = null;
      const report = selected();
      $("scope").replaceChildren();
      const add = (value, text) => { const option = el("option", text); option.value = value; $("scope").append(option); };
      add("whole", "Whole change: merge base to head");
      for (const [index, commit] of report.commits.entries()) add(`commit:${index}`,
        `${index + 1}. ${commit.sha.slice(0, 8)} ${commit.parentCount > 1 ? "[merge] " : ""}${commit.subject}`);
      for (const layer of report.layers) add(layer.id, `${layer.title} / ${count(layer.metrics)} / ${layer.metrics.files} files`);
      $("scope").value = typeof key === "string" ? key :
        !report.metrics.files ? report.layers.find((layer) => layer.metrics.files)?.id ?? "whole" : "whole";
      link($("source-link"), report.source.url);
      render();
    }
    function desk() {
      const query = $("search").value.toLowerCase(), shape = $("shape").value;
      $("report-rows").replaceChildren();
      for (const [index, report] of reports.entries()) {
        if (!`${report.title} ${report.source.repository}`.toLowerCase().includes(query)) continue;
        if (shape === "multi" && report.commits.length < 2) continue;
        const scopes = [
          { id: "whole", title: report.layers.length ? `${report.title} / Committed` : report.title, metrics: report.metrics },
          ...report.layers.filter((layer) => layer.metrics.files),
        ];
        for (const current of scopes) {
          const metrics = current.metrics;
          if (shape === "binary" && !metrics.binaryFiles) continue;
          if (shape === "incomplete" && !metrics.incomplete) continue;
          const row = el("tr"), title = el("td"), button = el("button", current.title);
          button.addEventListener("click", () => { $("report").value = index; load(current.id); show("receipt"); });
          title.append(button, el("div", report.source.repository, "muted"));
          const sum = (keys, field) => keys.reduce((total, key) => total + (metrics.categories[key]?.[field] ?? 0), 0);
          const tests = ["test", "test-support", "fixture", "snapshot"];
          row.append(title, el("td", count({ additions: sum(["source"], "additions"), deletions: sum(["source"], "deletions") }), "count"),
            el("td", count({ additions: sum(tests, "additions"), deletions: sum(tests, "deletions") }), "count"),
            el("td", String(metrics.files)), el("td", current.id === "whole" ? String(report.commits.length) : "Uncommitted"),
            el("td", String(metrics.binaryFiles)));
          $("report-rows").append(row);
        }
      }
      $("empty").hidden = $("report-rows").childElementCount > 0;
    }
    for (const [index, report] of reports.entries()) {
      const option = el("option", `${report.source.repository}: ${report.title}`);
      option.value = index;
      $("report").append(option);
    }
    $("report").addEventListener("change", load);
    $("scope").addEventListener("change", () => { category = null; render(); });
    $("search").addEventListener("input", desk);
    $("shape").addEventListener("change", desk);
    $("clear-category").addEventListener("click", () => { category = null; fileReceipts(scope().metrics); });
    $("inspect").addEventListener("click", () => show("receipt"));
    load(); desk(); show("desk");
  } catch (error) {
    $("error").textContent = `Unable to render report: ${error.message}`;
    $("error").hidden = false;
  }
})();
