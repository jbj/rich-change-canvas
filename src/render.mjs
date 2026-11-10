import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { measure } from "./metrics.mjs";

// Keep browser assets paired with the loaded renderer until the process reloads.
const template = readFileSync(new URL("../web/review.html", import.meta.url), "utf8");
const style = readFileSync(new URL("../web/review.css", import.meta.url), "utf8");
const script = readFileSync(new URL("../web/review.js", import.meta.url), "utf8");

export function renderReports(reports) {
  if (!Array.isArray(reports) || reports.length === 0) throw new Error("At least one report is required");
  const nonce = randomBytes(18).toString("base64");
  const enrichedReports = reports.map((report) =>
    report.layers?.length && !report.allMetrics ?
      { ...report, allMetrics: measure([...report.metrics.fileMetrics, ...report.layers.flatMap((layer) => layer.files)]) } :
      report);
  const assets = {
    __NONCE__: nonce,
    __STYLE__: style,
    __SCRIPT__: script,
    __DATA__: JSON.stringify(enrichedReports).replaceAll("<", "\\u003c"),
  };
  return template.replace(/__NONCE__|__STYLE__|__SCRIPT__|__DATA__/g, (key) => assets[key]);
}
