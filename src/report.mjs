import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, rename, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { measure } from "./metrics.mjs";
import { metricCatalog } from "./metric-analysis.mjs";
import { validateSyntaxSnapshots } from "./syntax/snapshot.mjs";

export const ANALYZER_VERSION = "syntax-snapshots-v1";

export function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function validateReportSyntax(report) {
  const snapshots = report.syntaxSnapshots ?? {};
  validateSyntaxSnapshots(snapshots);
  const files = [report.metrics, report.allMetrics, ...report.commits.map((commit) => commit.metrics),
    ...report.layers.map((layer) => layer.metrics)].flatMap((metrics) => metrics?.fileMetrics ?? []);
  for (const file of files) {
    for (const side of Object.values(file.syntax ?? {})) {
      if (side.id && (!snapshots[side.id] || snapshots[side.id].status !== side.status)) {
        throw new Error(`Missing or inconsistent syntax reference: ${file.path}`);
      }
    }
  }
}

export function createReport({ source, title, comparison, files, commits = [], layers = [], warnings = [],
  syntaxSnapshots = {} }) {
  syntaxSnapshots = { ...syntaxSnapshots };
  const compact = (records) => records.map((file) => {
    if (!file.syntax) return file;
    const syntax = Object.fromEntries(Object.entries(file.syntax).map(([side, snapshot]) => {
      if (snapshot.nodes) {
        syntaxSnapshots[snapshot.id] ??= snapshot;
        return [side, { id: snapshot.id, status: snapshot.status }];
      }
      if (snapshot.id && !syntaxSnapshots[snapshot.id]) throw new Error(`Missing syntax snapshot: ${snapshot.id}`);
      return [side, snapshot];
    }));
    return { ...file, syntax };
  });
  files = compact(files);
  commits = commits.map((commit) => ({ ...commit, files: compact(commit.files) }));
  layers = layers.map((layer) => ({ ...layer, files: compact(layer.files) }));
  const measuredCommits = commits.map((commit) => ({ ...commit, metrics: measure(commit.files) }));
  const allMetrics = layers.length ? measure([...files, ...layers.flatMap((layer) => layer.files)]) : null;
  const comparedSides = [files, ...commits.map((commit) => commit.files), ...layers.map((layer) => layer.files)]
    .flat().flatMap((file) => file.syntax ? Object.values(file.syntax) : [{ status: "missing-content" }, { status: "missing-content" }]);
  const coverage = Object.fromEntries([...new Set(comparedSides.map((side) => side.status))]
    .map((status) => [status, comparedSides.filter((side) => side.status === status).length]));
  const report = {
    schemaVersion: 1, analyzerVersion: ANALYZER_VERSION, metricCatalog, source, title,
    comparison, metrics: measure(files), commits: measuredCommits,
    ...(allMetrics ? { allMetrics } : {}),
    layers: layers.map((layer) => ({ ...layer, metrics: measure(layer.files) })),
    warnings, syntaxSnapshots,
    structuralAnalysis: { status: Object.keys(syntaxSnapshots).length ? "available" : "unavailable",
      capabilities: ["source-anchored-syntax", "cyclomatic-complexity"],
      coverage,
      reason: "Syntax evidence is per snapshot; parse errors and unsupported files are explicit. No semantic equivalence or coverage claim." },
  };
  validateReportSyntax(report);
  return { ...report, id: digest(JSON.stringify(report)) };
}

export async function saveReport(directory, report) {
  if (!directory) throw new Error("A report artifact directory is required");
  if (!/^[a-f0-9]{64}$/.test(report.id)) throw new Error("Invalid report identity");
  const { id, ...content } = report;
  if (digest(JSON.stringify(content)) !== id) throw new Error("Report content does not match its immutable identity");
  validateReportSyntax(report);
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${report.id}.json`);
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(report)}\n`, { flag: "wx", mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
  return path;
}

export async function loadReport(directory, id) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid report identity");
  const report = JSON.parse(await readFile(join(directory, `${id}.json`), "utf8"));
  const { id: savedId, ...content } = report;
  if (savedId !== id || digest(JSON.stringify(content)) !== id) {
    throw new Error("Report content does not match its immutable identity");
  }
  validateReportSyntax(report);
  return report;
}
