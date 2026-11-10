export function changedLines(patch, additions, deletions) {
  const result = { before: [], after: [] };
  let beforeRemaining = 0, afterRemaining = 0, inHunk = false;
  for (const line of patch.split("\n")) {
    const hunk = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
    if (hunk) {
      if (beforeRemaining || afterRemaining) throw new Error("Incomplete unified diff hunk");
      beforeRemaining = Number(hunk[1] ?? 1);
      afterRemaining = Number(hunk[2] ?? 1);
      inHunk = true;
      continue;
    }
    if (!inHunk || line.startsWith("\\") || !beforeRemaining && !afterRemaining) continue;
    if (line.startsWith("-")) {
      beforeRemaining--;
      result.before.push(line.slice(1));
    } else if (line.startsWith("+")) {
      afterRemaining--;
      result.after.push(line.slice(1));
    } else if (line.startsWith(" ")) {
      beforeRemaining--;
      afterRemaining--;
    } else {
      throw new Error("Invalid unified diff hunk line");
    }
    if (beforeRemaining < 0 || afterRemaining < 0) throw new Error("Inconsistent unified diff hunk");
  }
  if (beforeRemaining || afterRemaining ||
      result.before.length !== deletions || result.after.length !== additions) {
    throw new Error("Incomplete changed-line evidence");
  }
  return result;
}
