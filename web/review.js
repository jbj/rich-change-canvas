"use strict";
(() => {
  const $ = (id) => document.getElementById(id);
  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const spacerCell = () => {
    const cell = el("td", undefined, "table-spacer");
    cell.setAttribute("aria-hidden", "true");
    return cell;
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
    const total = parts.reduce((sum, [value]) => sum + value, 0);
    const scaledTotal = total && maximum ? Math.log1p(total) / Math.log1p(maximum) * 100 : 0;
    let offset = 0;
    for (const [value, className] of [[100, "bar-track"], ...parts]) {
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      const width = className === "bar-track" ? value : total ? scaledTotal * value / total : 0;
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
  function fileDiffUrl(report, current) {
    const candidate = current.url || report.source.url;
    if (!candidate) return null;
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    if (current.url) return parsed.href;
    if (!/\/pull\/\d+\/?$/.test(parsed.pathname)) return null;
    parsed.pathname = `${parsed.pathname.replace(/\/+$/, "")}/files`;
    return parsed.href;
  }
  function renderDiff(node, patch) {
    node.replaceChildren();
    for (const line of patch.split("\n")) {
      const className = line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff --git") ? "diff-meta" :
        line.startsWith("+") ? "diff-added" : line.startsWith("-") ? "diff-deleted" :
          line.startsWith("@@") ? "diff-hunk" : "";
      node.append(el("span", line, className), document.createTextNode("\n"));
    }
  }
  function loadLocalDiff(details, file, scopeKey, diffCell, diffRow, isCategoryExpanded) {
    let loaded = false;
    details.addEventListener("toggle", () => {
      diffRow.hidden = !details.open || !isCategoryExpanded();
      if (!details.open || loaded) return;
      loaded = true;
      const output = el("pre", "Loading diff…", "diff-content");
      output.setAttribute("role", "region");
      output.setAttribute("aria-label", `Diff for ${file.path}`);
      diffCell.append(output);
      const query = `scope=${encodeURIComponent(scopeKey)}&path=${encodeURIComponent(file.path)}`;
      fetch(`/diff?${query}`)
        .then(async (response) => {
          const result = await response.json();
          if (!response.ok) throw new Error(result.error ?? `Diff request failed (${response.status})`);
          return result;
        })
        .then((result) => {
          if (result.tooLarge) output.textContent = "Diff is too large to display here.";
          else if (result.binary) output.textContent = "Binary file; no text diff.";
          else if (!result.diff) output.textContent = "No textual changes in this scope.";
          else renderDiff(output, result.diff);
        })
        .catch((error) => { output.textContent = `Unable to load diff: ${error.message}`; });
    });
  }
  try {
    const reports = JSON.parse($("report-data").textContent);
    if (!Array.isArray(reports) || !reports.length) throw new Error("No reports were provided");
    const selected = () => reports[Number($("report").value)];
    const scope = () => {
      const report = selected();
      const key = $("scope").value;
      if (key === "all") return {
        key, metrics: report.allMetrics,
        fileScopes: [
          ...report.metrics.fileMetrics.map(() => "whole"),
          ...report.layers.flatMap((layer) => layer.metrics.fileMetrics.map(() => layer.id)),
        ],
      };
      if (key === "whole") return { key, metrics: report.metrics };
      if (key.startsWith("commit:")) {
        const commit = report.commits[Number(key.slice(7))];
        return { key, metrics: commit.metrics, url: commit.url };
      }
      const layer = report.layers.find((item) => item.id === key);
      if (!layer) throw new Error("Selected scope is unavailable");
      return { key, metrics: layer.metrics };
    };
    function totals(metrics) {
      $("totals").replaceChildren();
      for (const [value, title, className] of [
        [String(metrics.files), "files", "accent"],
        [delta(metrics), "text lines", ""],
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
    function fileRow(file, maximum, url, diffScope, isCategoryExpanded) {
      const row = el("tr", undefined, "file-row");
      row.dataset.filePath = file.path;
      row.dataset.category = file.category;
      row.hidden = true;
      const details = el("details");
      const summary = el("summary");
      summary.append(el("code", file.path, "file-name"), el("span", file.status, "file-meta"));
      details.append(summary);
      if (file.previousPath) details.append(el("p", `Previous path: ${file.previousPath}`));
      let diffRow;
      if (url) {
        const diffLink = el("a", "Open diff ↗", "file-diff");
        diffLink.href = url;
        diffLink.target = "_blank";
        diffLink.rel = "noreferrer noopener";
        details.append(diffLink);
      } else if (selected().source.kind === "local") {
        diffRow = el("tr", undefined, "diff-row");
        diffRow.hidden = true;
        diffRow.dataset.filePath = file.path;
        const diffCell = el("td");
        diffCell.colSpan = 4;
        diffRow.append(diffCell);
        loadLocalDiff(details, file, diffScope, diffCell, diffRow, isCategoryExpanded);
      } else {
        details.append(el("p", "Diff not included in this report.", "muted"));
      }
      const pathCell = el("td");
      pathCell.append(details);
      const metricCell = el("td");
      const barCell = el("td");
      const spacer = spacerCell();
      if (file.binary) {
        metricCell.append(el("span", `${file.beforeBytes ?? 0} → ${file.afterBytes ?? 0} B`, "count"));
      } else {
        metricCell.append(delta(file));
        barCell.append(bar([[file.additions, "bar-added"], [file.deletions, "bar-deleted"]],
          maximum, `${file.path}: ${count(file)} text lines; logarithmic scale 0–${maximum}`));
      }
      row.append(pathCell, metricCell, barCell, spacer);
      return { row, diffRow, details };
    }
    function originalCommits(report) {
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
            commitMaximum, `${count(commit.metrics)} text lines; logarithmic scale 0–${commitMaximum}`));
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
      link($("commit-link"), current.url);
      totals(metrics);
      $("category-rows").replaceChildren();
      const maximum = Math.max(0, ...Object.entries(metrics.categories)
        .filter(([key]) => key !== "binary").map(([, metric]) => metric.additions + metric.deletions));
      $("line-scale").textContent = `Log scale · max ${maximum} lines · binary: bytes`;
      const url = fileDiffUrl(report, current);
      for (const [key, metric] of Object.entries(metrics.categories)) {
        const categoryRow = el("tr", undefined, "category-row");
        categoryRow.dataset.category = key;
        const nameCell = el("td");
        const toggle = el("button", `${roles[key]} · ${metric.files}`, `role-name role-${key}`);
        toggle.setAttribute("aria-expanded", "false");
        nameCell.append(toggle);
        const metricCell = el("td");
        const barCell = el("td");
        if (key === "binary") {
          metricCell.append(el("span", `${metric.beforeBytes} → ${metric.afterBytes} B`, "count"));
        } else {
          metricCell.append(delta(metric));
          barCell.append(bar([[metric.additions, "bar-added"], [metric.deletions, "bar-deleted"]],
            maximum, `${roles[key]}: ${count(metric)} text lines; logarithmic scale 0–${maximum}`));
        }
        categoryRow.append(nameCell, metricCell, barCell, spacerCell());
        let expanded = false;
        const fileRows = metrics.fileMetrics
          .map((file, fileIndex) => ({ file, fileIndex }))
          .filter(({ file }) => file.category === key)
          .map(({ file, fileIndex }) => {
            const diffScope = current.fileScopes?.[fileIndex] ?? current.key;
            return fileRow(file, maximum, url, diffScope, () => expanded);
          });
        toggle.addEventListener("click", () => {
          expanded = !expanded;
          toggle.setAttribute("aria-expanded", String(expanded));
          for (const { row, diffRow, details } of fileRows) {
            row.hidden = !expanded;
            if (diffRow) diffRow.hidden = !expanded || !details.open;
          }
        });
        $("category-rows").append(categoryRow, ...fileRows.flatMap(({ row, diffRow }) =>
          diffRow ? [row, diffRow] : [row]));
      }
      $("role-empty").hidden = metrics.files > 0;
      originalCommits(report);
    }
    function selectScope(key) {
      $("scope").value = key;
      render();
    }
    function load(key) {
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
    $("scope").addEventListener("change", render);
    $("search").addEventListener("input", desk);
    $("shape").addEventListener("change", desk);
    load(); desk();
  } catch (error) {
    $("error").textContent = `Unable to render report: ${error.message}`;
    $("error").hidden = false;
    $("overview").hidden = true;
  }
})();
