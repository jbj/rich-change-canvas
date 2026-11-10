import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { measure } from "./metrics.mjs";
import { addAlternativeMetrics, metricCatalog } from "./metric-analysis.mjs";

export function renderReports(reports) {
  if (!Array.isArray(reports) || reports.length === 0) throw new Error("At least one report is required");
  const nonce = randomBytes(18).toString("base64");
  const template = readFileSync(new URL("../web/review.html", import.meta.url), "utf8");
  const upgrade = (metrics) => metrics.alternativeMetrics ? metrics : addAlternativeMetrics(metrics);
  const enrichedReports = reports.map((report) => ({
    ...report,
    metricCatalog: report.metricCatalog ?? metricCatalog,
    metrics: upgrade(report.metrics),
    commits: report.commits.map((commit) => ({ ...commit, metrics: upgrade(commit.metrics) })),
    layers: report.layers.map((layer) => ({ ...layer, metrics: upgrade(layer.metrics) })),
    ...(report.allMetrics ? { allMetrics: upgrade(report.allMetrics) } : report.layers.length ? {
      allMetrics: measure([...report.metrics.fileMetrics, ...report.layers.flatMap((layer) => layer.metrics.fileMetrics)]),
    } : {}),
  }));
  const assets = {
    __NONCE__: nonce,
    __STYLE__: readFileSync(new URL("../web/review.css", import.meta.url), "utf8"),
    __SCRIPT__: readFileSync(new URL("../web/review.js", import.meta.url), "utf8"),
    __DATA__: JSON.stringify(enrichedReports).replaceAll("<", "\\u003c"),
  };
  return template.replace(/__NONCE__|__STYLE__|__SCRIPT__|__DATA__/g, (key) => assets[key]);
}
