export function fitTableColumns(available, preferred, minimum) {
  if (!Number.isFinite(available) || available < 0 || !preferred.length ||
      preferred.length !== minimum.length || [...preferred, ...minimum].some((width) => !Number.isFinite(width) || width < 0)) {
    throw new RangeError("Column widths must be finite, non-negative numbers with matching preferred and minimum sizes");
  }
  const widths = [...preferred], floors = minimum.map((width, index) => Math.min(width, preferred[index]));
  let deficit = Math.max(0, widths.reduce((sum, width) => sum + width, 0) - available);
  const labelReduction = Math.min(deficit, widths[0] - floors[0]);
  widths[0] -= labelReduction;
  deficit -= labelReduction;
  const capacity = widths.slice(1).reduce((sum, width, index) => sum + width - floors[index + 1], 0);
  const reduction = Math.min(deficit, capacity);
  if (capacity) for (let index = 1; index < widths.length; index++) {
    widths[index] -= reduction * (widths[index] - floors[index]) / capacity;
  }
  deficit -= reduction;
  // Only viewports smaller than all minimums combined can reach this fallback.
  const remainingLabel = Math.min(deficit, widths[0]);
  widths[0] -= remainingLabel;
  deficit -= remainingLabel;
  const stats = widths.slice(1).reduce((sum, width) => sum + width, 0);
  if (deficit && stats) for (let index = 1; index < widths.length; index++) {
    widths[index] *= Math.max(0, stats - deficit) / stats;
  }
  return widths;
}
