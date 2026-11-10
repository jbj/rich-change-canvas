import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

export function renderReports(reports) {
  if (!Array.isArray(reports) || reports.length === 0) throw new Error("At least one report is required");
  const nonce = randomBytes(18).toString("base64");
  const template = readFileSync(new URL("../web/review.html", import.meta.url), "utf8");
  const assets = {
    __NONCE__: nonce,
    __STYLE__: readFileSync(new URL("../web/review.css", import.meta.url), "utf8"),
    __SCRIPT__: readFileSync(new URL("../web/review.js", import.meta.url), "utf8"),
    __DATA__: JSON.stringify(reports).replaceAll("<", "\\u003c"),
  };
  return template.replace(/__NONCE__|__STYLE__|__SCRIPT__|__DATA__/g, (key) => assets[key]);
}
