import { createReport } from "../src/report.mjs";
import { createSyntaxAnalyzer } from "../src/syntax/analyzer.mjs";
import { analyzeSnapshot, compareSnapshots } from "../src/metric-analysis.mjs";

export function tableLayoutFixtures() {
  const text = (path, additions = 1, deletions = 1, extra = {}) => ({
    path, status: "modified", additions, deletions, patchState: "complete", ...extra,
  });
  const binary = (path) => ({
    path, status: "modified", binary: true, additions: 0, deletions: 0,
    beforeBytes: 1_234_567_890_123, afterBytes: 9_876_543_210_123, patchState: "binary",
  });
  const long = `src/${"very-long-directory/".repeat(12)}${"W".repeat(60)}.js`;
  const huge = text("a.js", 1_234_567_890_123, 9_876_543_210_123);
  const parse = createSyntaxAnalyzer({ directory: null });
  const complexity = (path, before, after) => {
    const snapshot = (content) => {
      const bytes = Buffer.from(content);
      return analyzeSnapshot(bytes, path, { syntax: parse(bytes, path) });
    };
    return text(path, 1, 1, { alternativeMetrics: compareSnapshots(snapshot(before), snapshot(after)) });
  };
  return [
    ["Short paths and small counts", [text("a.js")]],
    ["Long filename with small counts", [text(long), text("b.js")]],
    ["Huge counts with short paths", [huge, binary("a.bin")]],
    ["Longest filename and widest stats in different rows", [text(long), huge, text("README.md")]],
    ["Renames, wide glyphs, combining marks and joined emoji", [
      text("W".repeat(80) + ".js", 1, 1, { status: "renamed", previousPath: "before.js" }),
      text(`test/${"ab\u0301👩🏽‍💻/".repeat(30)}a.test.js`),
    ]],
    ["Empty scope", []],
    ["Diffs must not enlarge the shared columns", [text("a.js", 1, 1, {
      diff: { diff: `diff --git a/a.js b/a.js\n--- a/a.js\n+++ b/a.js\n@@ -1 +1 @@\n-old\n+${"long-token".repeat(200)}\n` },
    })]],
    ["Summary complexity deltas with cancelling totals and a long path", [
      complexity(long, "function f() {}", "function f(x) { if (x) return; }"),
      complexity("down.js", "function f(x) { if (x) return; }", "function f() {}"),
      complexity("zero.js", "function f() {}", "function f() {}"),
      text("unavailable.js"),
    ]],
  ].map(([title, files]) => createReport({
    source: { kind: "fixture", repository: "shared-column-edge-cases" }, title, comparison: {}, files,
  }));
}
