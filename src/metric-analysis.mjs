import { snapshotPlugins, changePlugins } from "./metric-plugins/index.mjs";
import { textShape } from "./metric-plugins/text-shape.mjs";
import { aggregateSnapshots, measured, pair, unavailable, validatePlugins } from "./metric-plugins/runner.mjs";
import { regexPlugins } from "./regex-metrics/index.mjs";
import { languageForPath } from "./languages.mjs";
import { binary } from "./process.mjs";

const plugins = [...snapshotPlugins, ...regexPlugins];
validatePlugins([...plugins, ...changePlugins]);

export const metricCatalog = [
  { id: "lines", version: 1, label: "Added / deleted text lines", unit: "lines",
    tier: "Language-independent", mode: "churn",
    description: "Added/deleted physical text lines, including blanks and comments. Binary bytes are separate." },
  ...[...plugins, ...changePlugins].map(({ measure, supports, textOnly, ...metadata }) => metadata),
];

export function analyzeSnapshot(bytes, path) {
  bytes ??= Buffer.alloc(0);
  const isBinary = binary(bytes);
  const snapshot = { bytes, language: languageForPath(path),
    shape: isBinary ? null : textShape(bytes.toString("utf8")) };
  return Object.fromEntries(plugins.map((plugin) => {
    const result = plugin.textOnly && isBinary ? unavailable("unsupported", "Binary or non-UTF-8 content.") :
      plugin.supports && !plugin.supports(snapshot) ? unavailable("unsupported", "Language has no regex rules.") :
        measured(plugin, plugin.measure(snapshot));
    return [plugin.id, result];
  }));
}

export function compareSnapshots(before, after) {
  return Object.fromEntries(plugins.map((plugin) => [plugin.id, {
    version: plugin.version, ...pair(before[plugin.id], after[plugin.id]),
  }]));
}

function legacySide(plugin, file, side) {
  const absent = side === "before" ? file.status === "added" : file.status === "removed";
  if (plugin.id === "bytes") {
    const size = file[`${side}Bytes`];
    if (absent || Number.isSafeInteger(size) && size >= 0) {
      return measured(plugin, { numerator: absent ? 0 : size, denominator: 1 });
    }
  }
  if (plugin.textOnly && file.binary) return unavailable("unsupported", "Binary or non-UTF-8 content.");
  const language = languageForPath(side === "before" ? file.previousPath ?? file.path : file.path);
  if (plugin.supports && !plugin.supports({ language })) return unavailable("unsupported", "Language has no regex rules.");
  if (absent) {
    return measured(plugin, plugin.measure({ bytes: Buffer.alloc(0), shape: textShape(""), language }));
  }
  return unavailable("missing-content", "Source was not retained in this report; reacquire to measure.");
}

function enrichFile(file) {
  const alternatives = Object.fromEntries(plugins.map((plugin) => {
    const saved = file.alternativeMetrics?.[plugin.id];
    if (saved && saved.version !== plugin.version) {
      return [plugin.id, { version: plugin.version, ...pair(
        unavailable("missing-content", "Metric version differs; reacquire to measure."),
        unavailable("missing-content", "Metric version differs; reacquire to measure."),
      ) }];
    }
    return [plugin.id, saved ?? { version: plugin.version,
      ...pair(legacySide(plugin, file, "before"), legacySide(plugin, file, "after")) }];
  }));
  return { ...file, alternativeMetrics: alternatives };
}

function distribution(value) {
  return { value, status: value === null ? "not-applicable" : "available",
    reasons: value === null ? ["No changed text lines in this scope."] : [] };
}

export function addAlternativeMetrics(metrics) {
  const files = metrics.fileMetrics.map(enrichFile);
  const alternatives = aggregateSnapshots(plugins, files);
  const categories = Object.fromEntries(Object.entries(metrics.categories).map(([category, group]) => [
    category, { ...group, alternativeMetrics: aggregateSnapshots(plugins, files.filter((file) => file.category === category)) },
  ]));
  for (const plugin of changePlugins) {
    const result = plugin.measure(files);
    files.forEach((file, index) => {
      file.alternativeMetrics[plugin.id] = distribution(result.shares[index]);
    });
    for (const [category, group] of Object.entries(categories)) {
      const total = files.reduce((sum, file, index) =>
        file.category === category ? sum + (result.shares[index] ?? 0) : sum, 0);
      group.alternativeMetrics[plugin.id] = distribution(result.largestShare === null ? null : total);
    }
    alternatives[plugin.id] = { ...distribution(result.largestShare === null ? null : 100),
      largestShare: result.largestShare, entropy: result.entropy };
  }
  return { ...metrics, fileMetrics: files, categories, alternativeMetrics: alternatives };
}
