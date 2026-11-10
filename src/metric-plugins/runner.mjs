export function validatePlugins(plugins) {
  const ids = new Set();
  for (const plugin of plugins) {
    if (!/^[a-z][a-z0-9-]*$/.test(plugin.id) || plugin.id === "lines" || ids.has(plugin.id) ||
        !Number.isSafeInteger(plugin.version) || plugin.version < 1 ||
        typeof plugin.measure !== "function" ||
        !["snapshot", "distribution"].includes(plugin.mode) ||
        ![plugin.label, plugin.unit, plugin.description, plugin.tier].every((value) => typeof value === "string" && value) ||
        plugin.mode === "snapshot" && !["sum", "max", "mean", "ratio"].includes(plugin.reducer)) {
      throw new Error(`Invalid or duplicate metric plugin: ${plugin.id}`);
    }
    ids.add(plugin.id);
  }
}

export function unavailable(status, reason) {
  return { status, value: null, numerator: 0, denominator: 0,
    eligible: status === "missing-content" ? 1 : 0, measured: 0, reasons: [reason] };
}

function valueFor(plugin, numerator, denominator) {
  const value = ["ratio", "mean"].includes(plugin.reducer) ?
    denominator ? numerator / denominator * (plugin.reducer === "ratio" ? 100 : 1) : null : numerator;
  if (value !== null && (!Number.isFinite(value) || value < 0)) {
    throw new Error(`Invalid metric value: ${plugin.id}`);
  }
  return value;
}

export function measured(plugin, raw) {
  if (!raw || !Number.isFinite(raw.numerator) || raw.numerator < 0 ||
      !Number.isFinite(raw.denominator) || raw.denominator < 0) {
    throw new Error(`Invalid metric measurement: ${plugin.id}`);
  }
  const value = valueFor(plugin, raw.numerator, raw.denominator);
  return { ...raw, value, status: value === null ? "not-applicable" : "available",
    eligible: 1, measured: 1, reasons: value === null ? ["No eligible physical lines."] : [] };
}

export function aggregateSide(plugin, sides) {
  if (!sides.length) return { ...unavailable("not-applicable", "No changed files in this scope."),
    numerator: 0, denominator: 0 };
  let numerator = 0, denominator = 0, eligible = 0, count = 0;
  const reasons = new Set();
  for (const side of sides) {
    if (!side || !Number.isFinite(side.numerator) || !Number.isFinite(side.denominator) ||
        side.numerator < 0 || side.denominator < 0 ||
        !Number.isSafeInteger(side.eligible) || !Number.isSafeInteger(side.measured) ||
        side.measured < 0 || side.eligible < side.measured || !Array.isArray(side.reasons)) {
      throw new Error(`Invalid saved metric evidence: ${plugin.id}`);
    }
    numerator = plugin.reducer === "max" ? Math.max(numerator, side.numerator) : numerator + side.numerator;
    denominator += side.denominator;
    eligible += side.eligible;
    count += side.measured;
    for (const reason of side.reasons) reasons.add(reason);
  }
  const value = count ? valueFor(plugin, numerator, denominator) : null;
  const status = !eligible ? "unsupported" : !count ? "missing-content" :
    count < eligible ? "partial" : value === null ? "not-applicable" : "available";
  return { status, value, numerator, denominator, eligible, measured: count,
    reasons: status === "available" ? [] : [...reasons].filter((reason) =>
      count && value !== null ? reason !== "No eligible physical lines." : true) };
}

export function pair(before, after) {
  return { before, after, delta: before.value === null || after.value === null ? null : after.value - before.value };
}

export function aggregateSnapshots(plugins, files) {
  return Object.fromEntries(plugins.map((plugin) => [plugin.id, pair(
    aggregateSide(plugin, files.map((file) => file.alternativeMetrics[plugin.id].before)),
    aggregateSide(plugin, files.map((file) => file.alternativeMetrics[plugin.id].after)),
  )]));
}
