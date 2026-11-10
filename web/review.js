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
    source: "Source", test: "Tests", "test-support": "Test support",
    fixture: "Inputs", snapshot: "Snapshots", documentation: "Docs",
    manifest: "Build / deps", lockfile: "Lockfiles", generated: "Generated",
    configuration: "Config", markup: "Markup / styles", localization: "Translations",
    data: "Data", binary: "Binary", other: "Other",
  };
  const count = (metric) => `+${metric.additions} / -${metric.deletions}`;
  const delta = (metric) => {
    const node = el("span", undefined, "count");
    node.append(el("span", `+${metric.additions}`, "added"), document.createTextNode(" / "),
      el("span", `-${metric.deletions}`, "deleted"));
    return node;
  };
  function bar(parts, maximum, label) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "mini-bar");
    svg.setAttribute("viewBox", "0 0 100 8");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", label);
    let offset = 0;
    for (const [value, className] of [[maximum, "bar-track"], ...parts]) {
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      const width = maximum ? value / maximum * 100 : 0;
      rect.setAttribute("x", className === "bar-track" ? "0" : String(offset));
      rect.setAttribute("width", String(width));
      rect.setAttribute("height", "8");
      rect.setAttribute("class", className);
      svg.append(rect);
      if (className !== "bar-track") offset += width;
    }
    return svg;
  }
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
      if (key === "all") return { title: "All: committed + local snapshots",
        metrics: report.allMetrics, before: report.comparison.mergeBaseSha,
        after: `${report.comparison.headSha} + local snapshots` };
      if (key === "whole") return { title: "Committed: merge base to head", metrics: report.metrics,
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
    function totals(metrics) {
      $("totals").replaceChildren();
      for (const [value, title, className] of [
        [String(metrics.files), "files", "accent"],
        [delta(metrics), "text lines", ""],
        [String(metrics.largestFileChurn), "largest file · lines", ""],
        [String(metrics.binaryFiles), "binary files", "muted"],
      ]) {
        const stat = el("div", undefined, "stat");
        const number = el("span", undefined, `num ${className}`);
        if (typeof value === "string") number.textContent = value;
        else number.append(value);
        stat.append(number, el("span", title, "stat-label"));
        $("totals").append(stat);
      }
    }
    function fileReceipts(metrics) {
      const files = metrics.fileMetrics.filter((item) => !category || item.category === category);
      $("files-heading").textContent = `Files / ${files.length}${category ? ` · ${roles[category]}` : ""} · expand receipts`;
      $("clear-category").hidden = category === null;
      for (const button of $("category-rows").children) {
        button.setAttribute("aria-pressed", String(button.dataset.category === category));
      }
      $("file-list").replaceChildren();
      for (const file of files) {
        const details = el("details");
        const summary = el("summary");
        summary.append(el("code", file.path, "file-name"),
          el("span", `${roles[file.category]} · ${file.status} · `, "file-meta"),
          file.binary ? el("span", `${file.beforeBytes ?? 0} → ${file.afterBytes ?? 0} bytes`, "count") : delta(file));
        if (file.patchState === "missing-or-truncated") summary.append(el("span", " · incomplete patch", "warning"));
        details.append(summary, el("p", `${file.status}; ${file.patchState}; ${file.reason}`, "muted"));
        if (file.previousPath) details.append(el("p", `Previous path: ${file.previousPath}`));
        $("file-list").append(details);
      }
      if (!files.length) $("file-list").append(el("p", "No changed files in this scope.", "muted"));
    }
    function history(report) {
      const ordinary = report.commits.filter((commit) => commit.parentCount < 2)
        .reduce((sum, commit) => sum + commit.metrics.churn, 0);
      const merges = report.commits.filter((commit) => commit.parentCount > 1)
        .reduce((sum, commit) => sum + commit.metrics.churn, 0);
      const maximum = Math.max(report.metrics.churn, ordinary, merges);
      $("history-totals").replaceChildren();
      for (const [title, value, className] of [
        ["Final", report.metrics.churn, "bar-final"], ["Ordinary", ordinary, "bar-ordinary"], ["Merge context", merges, "bar-merge"],
      ]) {
        const row = el("div", undefined, "history-row");
        row.append(el("span", title), el("span", `${value} lines`, "count"),
          bar([[value, className]], maximum, `${title}: ${value} changed text lines; scale 0–${maximum}`));
        $("history-totals").append(row);
      }
      $("commits-heading").textContent = `Original commits / ${report.commits.length} · inspect`;
      $("commit-list").replaceChildren();
      const commitMaximum = Math.max(0, ...report.commits.map((commit) => commit.metrics.churn));
      for (const [index, commit] of report.commits.entries()) {
        const item = el("div", undefined, "commit");
        const button = el("button", `${commit.sha.slice(0, 8)} ${commit.subject}`);
        button.setAttribute("aria-current", String($("scope").value === `commit:${index}`));
        button.addEventListener("click", () => {
          selectScope(`commit:${index}`);
          $("commit-list").children[index].children[0].focus();
        });
        const meta = el("div", undefined, "history-row");
        meta.append(el("span", `${commit.parentCount > 1 ? `Merge · ${commit.parentCount} parents` : "Commit"} · ${commit.metrics.files} files`),
          delta(commit.metrics), bar([[commit.metrics.additions, "bar-added"], [commit.metrics.deletions, "bar-deleted"]],
            commitMaximum, `${count(commit.metrics)} text lines; scale 0–${commitMaximum}`));
        item.append(button, meta);
        $("commit-list").append(item);
      }
      if (!report.commits.length) $("commit-list").append(el("p", "No commits between merge base and HEAD.", "muted"));
    }
    function render() {
      const report = selected(), current = scope(), metrics = current.metrics;
      $("review-title").textContent = `${report.source.repository} / ${report.title}`;
      $("scope-note").textContent = report.layers.length ?
        "All combines independent committed / staged / unstaged / untracked snapshots. Counts are not additive; paths may repeat." :
        "Selected scope only. Text lines and binary bytes are separate.";
      $("comparison").replaceChildren(el("strong", current.title),
        el("p", `${current.before ?? "empty tree"} → ${current.after}`),
        el("p", `Report ${report.id} / ${report.analyzerVersion}`));
      link($("commit-link"), current.url);
      totals(metrics);
      $("category-rows").replaceChildren();
      const maximum = Math.max(0, ...Object.entries(metrics.categories)
        .filter(([key]) => key !== "binary").map(([, metric]) => metric.additions + metric.deletions));
      $("line-scale").textContent = `bars: 0–${maximum} lines · binary: bytes`;
      for (const [key, metric] of Object.entries(metrics.categories)) {
        const button = el("button", undefined, `role-row role-${key}`);
        button.dataset.category = key;
        button.setAttribute("aria-pressed", String(category === key));
        button.setAttribute("aria-controls", "file-list");
        button.append(el("span", `${roles[key]} · ${metric.files}`, "role-name"));
        if (key === "binary") {
          button.append(el("span", `${metric.beforeBytes} → ${metric.afterBytes} B`, "count"), el("span"));
        } else {
          button.append(delta(metric), bar([[metric.additions, "bar-added"], [metric.deletions, "bar-deleted"]],
            maximum, `${roles[key]}: ${count(metric)} text lines; scale 0–${maximum}`));
        }
        button.addEventListener("click", () => {
          category = category === key ? null : key;
          $("files-panel").open = true;
          fileReceipts(metrics);
        });
        $("category-rows").append(button);
      }
      $("role-empty").hidden = metrics.files > 0;
      $("evidence-status").replaceChildren(
        el("span", `Patches: ${metrics.incomplete} incomplete`, metrics.incomplete ? "warning" : "muted"),
        document.createTextNode(" "),
        el("span", `Notes: ${metrics.observations.length + report.warnings.length}`, metrics.observations.length + report.warnings.length ? "warning" : "muted"),
        document.createTextNode(" "),
        el("span", "Semantics: unavailable", "muted"));
      $("evidence").replaceChildren(
        el("p", `${metrics.incomplete} incomplete text patches in this scope.`, metrics.incomplete ? "warning" : "muted"),
        el("p", `Semantic analysis unavailable: ${report.structuralAnalysis.reason}`, "muted"));
      if (report.source.state) $("evidence").append(el("p", `PR state: ${report.source.state}`));
      if (report.source.discussion) $("evidence").append(
        el("p", `${report.source.discussion.issueComments} issue comments; ${report.source.discussion.inlineComments} inline comments.`),
        el("p", report.source.discussion.note, "muted"));
      for (const warning of report.warnings) $("evidence").append(el("p", warning, "warning"));
      $("observations").replaceChildren();
      for (const observation of metrics.observations) $("observations").append(el("p", observation, "observation"));
      fileReceipts(metrics);
      history(report);
    }
    function selectScope(key) {
      $("scope").value = key;
      category = null;
      render();
    }
    function load(key) {
      category = null;
      const report = selected();
      $("scope").replaceChildren();
      const add = (value, text) => { const option = el("option", text); option.value = value; $("scope").append(option); };
      if (report.layers.length) add("all", `All · ${report.allMetrics.files} files · ${count(report.allMetrics)}`);
      add("whole", `Committed · ${report.metrics.files} files · ${count(report.metrics)}`);
      for (const layer of report.layers) add(layer.id, `${layer.title} · ${layer.metrics.files} files · ${count(layer.metrics)}`);
      for (const [index, commit] of report.commits.entries()) add(`commit:${index}`,
        `${commit.sha.slice(0, 8)} ${commit.parentCount > 1 ? "[merge] " : ""}${commit.subject}`);
      $("scope").value = typeof key === "string" ? key :
        report.layers.length ? "all" : "whole";
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
          button.addEventListener("click", () => { $("report").value = String(index); load(current.id); });
          title.append(button, el("div", report.source.repository, "muted"));
          const sum = (keys, field) => keys.reduce((total, key) => total + (metrics.categories[key]?.[field] ?? 0), 0);
          const tests = ["test", "test-support", "fixture", "snapshot"];
          const source = el("td"), support = el("td");
          source.append(delta({ additions: sum(["source"], "additions"), deletions: sum(["source"], "deletions") }));
          support.append(delta({ additions: sum(tests, "additions"), deletions: sum(tests, "deletions") }));
          row.append(title, source, support, el("td", String(metrics.files)),
            el("td", current.id === "whole" ? String(report.commits.length) : "Local"), el("td", String(metrics.binaryFiles)));
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
    $("report").value = "0";
    $("report-control").hidden = reports.length === 1;
    $("reports-panel").hidden = reports.length === 1 && !reports[0].layers.some((layer) => layer.metrics.files);
    $("report").addEventListener("change", () => load());
    $("scope").addEventListener("change", () => { category = null; render(); });
    $("search").addEventListener("input", desk);
    $("shape").addEventListener("change", desk);
    $("clear-category").addEventListener("click", () => { category = null; fileReceipts(scope().metrics); });
    load(); desk();
  } catch (error) {
    $("error").textContent = `Unable to render report: ${error.message}`;
    $("error").hidden = false;
    $("overview").hidden = true;
  }
})();
