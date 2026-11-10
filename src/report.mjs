import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, rename, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { measure } from "./metrics.mjs";
import { metricCatalog } from "./metric-analysis.mjs";

export const ANALYZER_VERSION = "absolute-diffstat-metrics-v1";

export function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function createReport({ source, title, comparison, files, commits = [], layers = [], warnings = [] }) {
  const measuredCommits = commits.map((commit) => ({ ...commit, metrics: measure(commit.files) }));
  const allMetrics = layers.length ? measure([...files, ...layers.flatMap((layer) => layer.files)]) : null;
  const report = {
    schemaVersion: 1, analyzerVersion: ANALYZER_VERSION, metricCatalog, source, title,
    comparison, metrics: measure(files), commits: measuredCommits,
    ...(allMetrics ? { allMetrics } : {}),
    layers: layers.map((layer) => ({ ...layer, metrics: measure(layer.files) })),
    warnings,
    structuralAnalysis: { status: "unavailable", reason: "This baseline reports file-level evidence, not semantic equivalence or coverage." },
  };
  return { ...report, id: digest(JSON.stringify(report)) };
}

export async function saveReport(directory, report) {
  if (!directory) throw new Error("A report artifact directory is required");
  if (!/^[a-f0-9]{64}$/.test(report.id)) throw new Error("Invalid report identity");
  const { id, ...content } = report;
  if (digest(JSON.stringify(content)) !== id) throw new Error("Report content does not match its immutable identity");
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${report.id}.json`);
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx", mode: 0o600 });
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
  return report;
}
