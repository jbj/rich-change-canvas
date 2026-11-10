export function physicalLines(text) {
  if (!text) return [];
  const lines = text.split("\n");
  const terminated = text.endsWith("\n");
  if (terminated) lines.pop();
  return lines.map((line, index) => line.endsWith("\r") && (terminated || index < lines.length - 1) ?
    line.slice(0, -1) : line);
}

export function textShape(text) {
  const lines = physicalLines(text);
  let blank = 0, characters = 0, maximum = 0, long = 0, trailing = 0, indentation = 0, repeated = 0;
  const seen = new Set();
  for (const line of lines) {
    let length = 0;
    for (const character of line) length++;
    characters += length;
    maximum = Math.max(maximum, length);
    if (length > 120) long++;
    if (/[ \t]$/.test(line)) trailing++;
    if (/^\s*$/u.test(line)) {
      blank++;
      continue;
    }
    let columns = 0;
    for (const character of line) {
      if (character === " ") columns++;
      else if (character === "\t") columns += 4 - columns % 4;
      else break;
    }
    indentation = Math.max(indentation, columns);
    const trimmed = line.trim();
    if (seen.has(trimmed)) repeated++;
    else seen.add(trimmed);
  }
  return { lines, blank, characters, maximum, long, trailing, indentation, repeated };
}

const shape = (id, label, unit, reducer, description, measure, options = {}) => ({
  id, version: 1, label, unit, reducer, description,
  tier: "Language-independent", mode: "snapshot", textOnly: true, measure, ...options,
});
const ratio = (numerator, denominator) => ({ numerator, denominator });

export const textPlugins = [
  shape("blank-lines", "Blank lines", "lines", "sum",
    "Whitespace-only physical lines. Counts qualifying added and removed lines separately.",
    ({ shape: s }) => ratio(s.blank, 1),
    { mode: "diffstat", legacy: { id: "blank-share", version: 1 } }),
  shape("mean-line-length", "Mean line length", "code points", "mean",
    "Unicode code points per physical line, excluding LF and CRLF terminators.",
    ({ shape: s }) => ratio(s.characters, s.lines.length)),
  shape("max-line-length", "Maximum line length", "code points", "max",
    "Longest physical line in Unicode code points. Aggregates use the maximum, not a sum.",
    ({ shape: s }) => ratio(s.maximum, 1)),
  shape("long-lines", "Long lines", "lines", "sum",
    "Physical lines longer than 120 Unicode code points. Counts qualifying added and removed lines separately.",
    ({ shape: s }) => ratio(s.long, 1),
    { mode: "diffstat", legacy: { id: "long-line-share", version: 1 } }),
  shape("trailing-whitespace", "Trailing-whitespace lines", "lines", "sum",
    "Physical lines ending in a space or tab. Counts qualifying added and removed lines separately.",
    ({ shape: s }) => ratio(s.trailing, 1),
    { mode: "diffstat", version: 2, legacy: { id: "trailing-whitespace", version: 1 } }),
  shape("indentation", "Maximum textual indentation", "columns", "max",
    "Leading spaces/tabs on nonblank lines; tabs advance to four-column stops. Not syntax nesting.",
    ({ shape: s }) => ratio(s.indentation, 1)),
  shape("repeated-lines", "Repeated lines", "lines", "sum",
    "Occurrences beyond the first of trimmed nonblank lines within each file. Whole-file before/after counts: repetition depends on surrounding lines, not just edits. Not code-clone detection.",
    ({ shape: s }) => ratio(s.repeated, 1),
    { legacy: { id: "repetition", version: 1 } }),
];
