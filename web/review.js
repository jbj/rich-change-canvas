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
  const count = (metric) => [
    metric.additions ? `+${metric.additions}` : "",
    metric.deletions ? `-${metric.deletions}` : "",
  ].filter(Boolean).join(" / ") || "±0";
  const delta = (metric) => {
    const node = el("span", undefined, "count");
    if (metric.additions) node.append(el("span", `+${metric.additions}`, "added"));
    if (metric.deletions) {
      if (node.childElementCount) node.append(document.createTextNode(" / "));
      node.append(el("span", `-${metric.deletions}`, "deleted"));
    }
    if (!node.childElementCount) node.append(el("span", "±0", "zero"));
    return node;
  };
  function bar(parts, maximum, label) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "mini-bar");
    svg.setAttribute("viewBox", "0 0 100 8");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", label);
    const total = parts.reduce((sum, [value]) => sum + value, 0);
    if (!total) return document.createTextNode("");
    const scaledTotal = total && maximum ? Math.min(100, total / maximum * 100) : 0;
    let offset = 0;
    for (const [value, className] of [[100, "bar-track"], ...parts]) {
      if (!value) continue;
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
    const definitions = new Map([["lines", { id: "lines", label: "Added / deleted text lines",
      tier: "Language-independent", unit: "lines", mode: "churn",
      description: "Added/deleted physical text lines, including blanks and comments. Binary bytes are separate." }]]);
    for (const report of reports) for (const definition of report.metricCatalog ?? []) {
      if (!definitions.has(definition.id)) definitions.set(definition.id, definition);
    }
    const metric = () => selected().metricCatalog?.find((definition) => definition.id === $("metric").value) ??
      definitions.get($("metric").value);
    const isLines = () => metric().mode === "churn";
    const isDiffstat = () => metric().mode === "diffstat";
    const numeric = (value) => Number(value.toFixed(2)).toLocaleString("en-US");
    const number = (value) => value === null || value === undefined ? "N/A" : numeric(value);
    const evidence = (target) => target.alternativeMetrics?.[metric().id];
    const knownZero = (side) => side?.status === "available" && side.value === 0;
    const inapplicable = (side) => side?.status === "unsupported" || side?.status === "not-applicable";
    function inapplicableMetric(target) {
      const result = evidence(target);
      return (isDiffstat() ? [result?.changes?.additions, result?.changes?.deletions] :
        [result?.before, result?.after]).every(inapplicable);
    }
    const nonTextChange = (file) => file.binary || file.status === "renamed" || file.status === "copied";
    function omitFile(file) {
      if (isLines()) return !file.additions && !file.deletions && !nonTextChange(file);
      if (inapplicableMetric(file)) return true;
      if (!isDiffstat()) return false;
      const changes = evidence(file)?.changes;
      return [changes?.additions, changes?.deletions].every((side) => knownZero(side) || inapplicable(side)) &&
        !(metric().id === "churn" && nonTextChange(file));
    }
    function sideText(side) {
      if (!side) return "Unavailable";
      if (side.value === null) return side.status === "missing-content" ? "Unavailable" : "N/A";
      return `${number(side.value)}${side.status === "partial" ? " (partial)" : ""}`;
    }
    function availability(result) {
      if (!result) return "Metric was not measured in this report; reacquire to measure.";
      const entries = isDiffstat() ? result.changes : result;
      return (isDiffstat() ? ["additions", "deletions"] : ["before", "after"]).map((side) => {
        const entry = entries?.[side];
        if (!entry) return `${side}: unavailable`;
        return `${side}: ${entry.measured}/${entry.eligible} eligible files measured; ${entry.status}${entry.reasons.length ? `; ${entry.reasons.join(" ")}` : ""}`;
      }).join(". ");
    }
    function metricValue(target) {
      if (isLines()) return delta(target);
      const result = evidence(target);
      const node = el("span", undefined, "count");
      node.setAttribute("title", availability(result));
      if (inapplicableMetric(target)) {
        node.textContent = "Not applicable";
        return node;
      }
      if (isDiffstat()) {
        const changes = result?.changes;
        if (changes?.additions?.value === 0 && changes?.deletions?.value === 0) {
          const partial = changes.additions.status === "partial" || changes.deletions.status === "partial";
          node.append(el("span", `±0${partial ? " (partial)" : ""}`, "zero"));
        } else {
          for (const [side, sign, className] of [["additions", "+", "added"], ["deletions", "-", "deleted"]]) {
            const entry = changes?.[side];
            if (knownZero(entry) || inapplicable(entry)) continue;
            if (node.childElementCount) node.append(document.createTextNode(" / "));
            node.append(el("span", `${sign}${sideText(entry)}`, className));
          }
          if (!node.childElementCount) node.append(el("span", "±0", "zero"));
        }
        if (node.childElementCount) node.append(document.createTextNode(` ${metric().unit}`));
        if ((!result?.changes?.additions || !result?.changes?.deletions ||
             result.changes.additions.status === "missing-content" || result.changes.deletions.status === "missing-content") &&
            (result?.before?.value !== null && result?.before?.value !== undefined ||
             result?.after?.value !== null && result?.after?.value !== undefined)) {
          node.append(el("span", ` (whole file: ${sideText(result.before)} → ${sideText(result.after)})`, "muted"));
        }
      } else {
        const change = result?.delta;
        node.textContent = `${sideText(result?.before)} → ${sideText(result?.after)} ${metric().unit}` +
          (change === null || change === undefined ? "" : ` (Δ ${change > 0 ? "+" : ""}${number(change)})`);
      }
      return node;
    }
    function metricBar(target, maximum, label) {
      const result = evidence(target);
      if (inapplicableMetric(target)) return document.createTextNode("");
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "mini-bar");
      svg.setAttribute("viewBox", "0 0 100 8");
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", `${label}: ${metricValue(target).textContent}; linear scale 0–${number(maximum)} ${metric().unit}. ${availability(result)}`);
      const parts = [[result?.before?.value, "bar-before", 0, 3], [result?.after?.value, "bar-after", 5, 3]];
      for (const [value, className, y, height] of parts) {
        if (value === null || value === undefined) continue;
        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("x", "0");
        rect.setAttribute("y", String(y));
        rect.setAttribute("height", String(height));
        rect.setAttribute("width", String(maximum ? Math.min(100, value / maximum * 100) : 0));
        rect.setAttribute("class", className);
        svg.append(rect);
      }
      return svg;
    }
    function metricMaximum(metrics) {
      if (isLines()) return Math.max(0, ...Object.entries(metrics.categories)
        .filter(([key]) => key !== "binary").map(([, group]) => group.additions + group.deletions));
      let maximum = 0;
      for (const target of [...Object.values(metrics.categories), ...metrics.fileMetrics]) {
        const result = evidence(target);
        maximum = isDiffstat() ? Math.max(maximum,
          (result?.changes?.additions?.value ?? 0) + (result?.changes?.deletions?.value ?? 0)) :
          Math.max(maximum, result?.before?.value ?? 0, result?.after?.value ?? 0);
      }
      return maximum;
    }
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
      const result = evidence(metrics);
      let summary = String(metrics.binaryFiles), summaryLabel = "binary files";
      if (!isLines()) {
        summary = availability(result);
        summaryLabel = "measurement coverage";
      }
      for (const [value, title, className] of [
        [String(metrics.files), "files", "accent"],
        [metricValue(metrics), isLines() ? "text lines" : metric().label, ""],
        [summary, summaryLabel, "muted"],
      ]) {
        const stat = el("div", undefined, "stat");
        const valueNode = el("span", undefined, `num ${className}${title === "measurement coverage" ? " coverage" : ""}`);
        if (typeof value === "string") valueNode.textContent = value;
        else valueNode.append(value);
        stat.append(valueNode, el("span", title, "stat-label"));
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
        diffCell.colSpan = isDiffstat() ? 3 : 4;
        diffRow.append(diffCell);
        loadLocalDiff(details, file, diffScope, diffCell, diffRow, isCategoryExpanded);
      } else {
        details.append(el("p", "Diff not included in this report.", "muted"));
      }
      const pathCell = el("td");
      pathCell.append(details);
      const metricCell = el("td");
      const barCell = isDiffstat() ? null : el("td");
      const spacer = spacerCell();
      if (!isLines()) {
        metricCell.append(metricValue(file));
        if (barCell) barCell.append(metricBar(file, maximum, file.path));
      } else if (file.binary) {
        metricCell.append(el("span", `${file.beforeBytes ?? 0} → ${file.afterBytes ?? 0} B`, "count"));
      } else {
        metricCell.append(delta(file));
        barCell.append(bar([[file.additions, "bar-added"], [file.deletions, "bar-deleted"]],
          maximum, `${file.path}: ${count(file)} text lines; linear scale 0–${maximum}`));
      }
      row.append(pathCell, metricCell, ...(barCell ? [barCell] : []), spacer);
      return { row, diffRow, details };
    }
    function originalCommits(report) {
      $("commits-heading").textContent = `Original commits / ${report.commits.length} · inspect · text lines`;
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
            commitMaximum, `${count(commit.metrics)} text lines; linear scale 0–${commitMaximum}`));
        item.append(button, meta);
        $("commit-list").append(item);
      }
      if (!report.commits.length) $("commit-list").append(el("p", "No commits between merge base and HEAD.", "muted"));
    }
    const expandedRoles = new Set();
    function render(preserveRoles = false) {
      if (preserveRoles !== true) expandedRoles.clear();
      const report = selected(), current = scope(), metrics = current.metrics;
      $("overview").dataset.metricMode = metric().mode;
      $("overview").className = isLines() ? "" : "alternative-metric";
      $("review-title").textContent = `${report.source.repository} / ${report.title}`;
      $("scope-note").textContent = report.layers.length ?
        "All combines independent committed / staged / unstaged / untracked snapshots. Counts are not additive; paths may repeat." :
        "Selected scope only. Text lines and binary bytes are separate.";
      link($("commit-link"), current.url);
      totals(metrics);
      $("category-rows").replaceChildren();
      const maximum = metricMaximum(metrics);
      $("metric-heading").textContent = `/ ${metric().label}`;
      $("metric-note").textContent = `${metric().tier} · ${metric().description}` +
        (isDiffstat() ? " Changed-line counts, not net differences: a qualifying replacement can count on both sides." : isLines() ? "" :
          " Whole changed-file snapshots, not only edited lines. Before/after deltas are not safety or quality scores.");
      $("value-heading").textContent = isLines() ? "+added / −deleted" :
        isDiffstat() ? "+added / −removed" : "Before → after (Δ)";
      $("bar-heading").textContent = isLines() || isDiffstat() ? "Churn" : "Snapshots";
      $("bar-heading").hidden = isDiffstat();
      $("metric-legend").hidden = isDiffstat();
      $("legend-before").textContent = isLines() || isDiffstat() ? "+ added" : "before (top)";
      $("legend-after").textContent = isLines() ? "− deleted" : isDiffstat() ? "− removed" : "after (bottom)";
      $("legend-before").className = isLines() || isDiffstat() ? "added" : "snapshot-before";
      $("legend-after").className = isLines() || isDiffstat() ? "deleted" : "snapshot-after";
      $("line-scale").textContent = isLines() ? `Linear scale · 0–${maximum} lines · binary: bytes` :
        `Linear scale · 0–${number(maximum)} ${metric().unit}`;
      const url = fileDiffUrl(report, current);
      for (const [key, metric] of Object.entries(metrics.categories)) {
        const files = metrics.fileMetrics
          .map((file, fileIndex) => ({ file, fileIndex }))
          .filter(({ file }) => file.category === key && !omitFile(file));
        if (!files.length) continue;
        const categoryRow = el("tr", undefined, "category-row");
        categoryRow.dataset.category = key;
        let expanded = expandedRoles.has(key);
        categoryRow.dataset.expanded = String(expanded);
        const nameCell = el("td");
        const toggle = el("button", `${roles[key]} · ${files.length}`, `role-name role-${key}`);
        toggle.setAttribute("aria-expanded", String(expanded));
        nameCell.append(toggle);
        const metricCell = el("td");
        const barCell = isDiffstat() ? null : el("td");
        if (!isLines()) {
          metricCell.append(metricValue(metric));
          if (barCell) barCell.append(metricBar(metric, maximum, roles[key]));
        } else if (key === "binary") {
          metricCell.append(el("span", `${metric.beforeBytes} → ${metric.afterBytes} B`, "count"));
        } else {
          metricCell.append(delta(metric));
          barCell.append(bar([[metric.additions, "bar-added"], [metric.deletions, "bar-deleted"]],
            maximum, `${roles[key]}: ${count(metric)} text lines; linear scale 0–${maximum}`));
        }
        categoryRow.append(nameCell, metricCell, ...(barCell ? [barCell] : []), spacerCell());
        const fileRows = files
          .map(({ file, fileIndex }) => {
            const diffScope = current.fileScopes?.[fileIndex] ?? current.key;
            const result = fileRow(file, maximum, url, diffScope, () => expanded);
            result.row.hidden = !expanded;
            return result;
          });
        toggle.addEventListener("click", () => {
          expanded = !expanded;
          if (expanded) expandedRoles.add(key);
          else expandedRoles.delete(key);
          categoryRow.dataset.expanded = String(expanded);
          toggle.setAttribute("aria-expanded", String(expanded));
          for (const { row, diffRow, details } of fileRows) {
            row.hidden = !expanded;
            if (diffRow) diffRow.hidden = !expanded || !details.open;
          }
        });
        $("category-rows").append(categoryRow, ...fileRows.flatMap(({ row, diffRow }) =>
          diffRow ? [row, diffRow] : [row]));
      }
      $("role-empty").hidden = $("category-rows").childElementCount > 0;
      $("role-empty").textContent = !metrics.files ? "No files changed in this scope." :
        inapplicableMetric(metrics) ? "This metric does not apply to files in this scope." : "No changes for this metric.";
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
      const scopeLabel = (title, metrics) => `${title} · ${metrics.files} files${metrics.files ? ` · ${count(metrics)}` : ""}`;
      if (report.layers.length) add("all", scopeLabel("All", report.allMetrics));
      add("whole", scopeLabel("Committed", report.metrics));
      for (const layer of report.layers) add(layer.id, scopeLabel(layer.title, layer.metrics));
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
          if (!metrics.additions && !metrics.deletions && !metrics.fileMetrics.some(nonTextChange)) continue;
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
    const groups = new Map();
    for (const definition of definitions.values()) {
      if (!groups.has(definition.tier)) {
        const group = el("optgroup");
        group.setAttribute("label", definition.tier);
        groups.set(definition.tier, group);
        $("metric").append(group);
      }
      const option = el("option", definition.label);
      option.value = definition.id;
      groups.get(definition.tier).append(option);
    }
    $("metric").value = "lines";
    $("report-control").hidden = reports.length === 1;
    $("reports-panel").hidden = reports.length === 1 && !reports[0].layers.some((layer) => layer.metrics.files);
    $("report").addEventListener("change", () => load());
    $("scope").addEventListener("change", render);
    $("metric").addEventListener("change", () => render(true));
    $("search").addEventListener("input", desk);
    $("shape").addEventListener("change", desk);
    load(); desk();
  } catch (error) {
    $("error").textContent = `Unable to render report: ${error.message}`;
    $("error").hidden = false;
    $("overview").hidden = true;
  }
})();
