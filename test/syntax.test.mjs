import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createSyntaxAnalyzer } from "../src/syntax/analyzer.mjs";
import { unpackSnapshot } from "../src/syntax/encoding.mjs";
import { children, selectNodes, functionComplexities } from "../src/syntax/rules.mjs";
import { analyzeSnapshot } from "../src/metric-analysis.mjs";
import { createReport, saveReport, loadReport, digest } from "../src/report.mjs";
import { measure } from "../src/metrics.mjs";

const analyze = createSyntaxAnalyzer({ directory: null });
const parse = (path, text) => analyze(Buffer.from(text), path);
const samples = [
  ["x.js", "function f(x) { if (x && x) return x ? 1 : 0; return 0; }", [4]],
  ["x.jsx", "const f = (x) => x && <b/>;", [2]],
  ["x.ts", "function f(x: boolean): number { return x ? 1 : 0; }", [2]],
  ["x.tsx", "const f = (x: boolean) => x && <b/>;", [2]],
  ["x.py", "def f(xs):\n    return [x for x in xs if x and x]\n", [4]],
  ["x.go", "package p\nfunc f(x bool) int { for x { if x && x { return 1 } }; return 0 }", [4]],
  ["x.rs", "fn f(x: bool) -> i32 { if x && x { 1 } else { 0 } }", [3]],
  ["X.java", "class X { X() {} int f(boolean x) { if (x && x) return x ? 1 : 0; return 0; } }", [1, 4]],
];

test("All six grammars and JSX/TSX yield hand-calculated function complexities", () => {
  for (const [path, code, expected] of samples) {
    const snapshot = parse(path, code);
    assert.equal(snapshot.status, "available", path);
    assert.deepEqual(functionComplexities(snapshot).map((fn) => fn.value), expected, path);
    assert.deepEqual(functionComplexities(unpackSnapshot(snapshot)), functionComplexities(snapshot), path);
    const side = analyzeSnapshot(Buffer.from(code), path, { syntax: snapshot })["cyclomatic-complexity"];
    assert.equal(side.value, expected.reduce((sum, value) => sum + value, 0), path);
    assert.deepEqual(side.functions, functionComplexities(snapshot));
  }
});

test("Nested functions own their decisions; declarations, strings and comments do not count", () => {
  for (const [path, code, expected] of [
    ["x.js", 'function outer(x) { const g = () => x ? 1 : 0; if (x && x) return g(); return "if ||"; } // while &&', [3, 2]],
    ["x.py", "def f(x):\n    def g():\n        return 1 if x else 0\n    return g\n", [1, 2]],
    ["x.go", "package p\nfunc f(x bool) { g := func() { if x {} }; _ = g }", [1, 2]],
    ["x.rs", "fn f(x: bool) { let g = || if x { 1 } else { 0 }; }", [1, 2]],
    ["X.java", "abstract class X { abstract void empty(); void f() { Runnable r = () -> { if (true) {} }; } }", [1, 2]],
    ["x.ts", "declare function f(x: boolean): number;\ninterface X { f(): void; }", []],
    ["x.js", "if (true) { while (false) {} }", []],
  ]) {
    const snapshot = parse(path, code);
    assert.equal(snapshot.status, "available", path);
    assert.deepEqual(functionComplexities(snapshot).map((fn) => fn.value), expected, path);
  }
});

test("Language-specific arm, guard, handler, loop and short-circuit rules exclude defaults", () => {
  for (const [path, code, expected] of [
    ["x.js", "function f(x) { switch(x) { case 1: break; case 2: break; default: break; } try {} catch(e) {} x ||= 1; }", 5],
    ["x.py", "def f(x):\n    match x:\n        case 1 if x:\n            return 1\n        case _:\n            return 0\n", 3],
    ["x.py", "def f(x):\n    try:\n        while x or x:\n            for i in x:\n                pass\n    except ValueError:\n        pass\n    except:\n        pass\n", 6],
    ["x.go", "package p\nfunc f(x int) { switch x { case 1,2: return; default: return }; select {case <-ch: return; default: return} }", 3],
    ["x.rs", "fn f(x: i32) -> i32 { match x { 1 | 2 if x > 0 => 2, _ => 0 } }", 3],
    ["x.rs", "fn f() { loop { break; } }", 2],
    ["X.java", "class X { int f(int x) { return switch(x) { case 1,2 -> 2; default -> 0; }; } }", 2],
    ["X.java", "class X { void f() { try { for (;;) { break; } } catch(Exception e) {} finally {} } }", 3],
  ]) {
    const snapshot = parse(path, code);
    assert.equal(snapshot.status, "available", path);
    assert.equal(functionComplexities(snapshot).reduce((sum, fn) => sum + fn.value, 0), expected, path);
    assert.ok(selectNodes(snapshot, { kind: "decision" }).length, path);
  }
});

test("Serialized trees retain fields, concrete operators and exact UTF-8/UTF-16 anchors", () => {
  const code = '\ufeff// 😀 café\r\nfunction café(x) { return x && "😀"; }\r\n';
  const snapshot = parse("x.js", code);
  const restored = unpackSnapshot(JSON.parse(JSON.stringify(snapshot)));
  const fn = selectNodes(restored, { kind: "function" })[0];
  assert.equal(children(restored, fn, "name")[0].value, "café");
  const operator = selectNodes(restored, { type: "&&" })[0];
  assert.equal(operator.named, false);
  for (const node of restored.nodes) {
    const { startByte, endByte, startIndex, endIndex } = node.range;
    assert.equal(Buffer.from(code).subarray(startByte, endByte).toString("utf8"), code.slice(startIndex, endIndex));
    if (node.parent !== null) assert.ok(restored.nodes[node.parent].children.includes(node.id));
  }
  assert.equal(fn.range.startPosition.row, 1);
  assert.equal(fn.range.startPosition.column, 0);
  assert.notEqual(fn.range.startByte, fn.range.startIndex);
  assert.ok(!JSON.stringify(snapshot).includes('return x &&'));
});

test("Absent, empty, unsupported, binary, malformed and resource-limited snapshots stay distinct", () => {
  assert.equal(analyze(null, "x.js").status, "absent");
  assert.equal(parse("x.js", "").status, "available");
  assert.equal(parse("x.md", "").status, "unsupported");
  assert.equal(analyze(Buffer.from([0xff]), "x.js").status, "unsupported");
  const bad = parse("x.js", "function f( {");
  assert.equal(bad.status, "parse-error");
  assert.ok(bad.diagnostics.some((item) => item.kind === "error" || item.kind === "missing"));
  const limited = createSyntaxAnalyzer({ directory: null, maxNodes: 1 })(Buffer.from("let x = 1;"), "x.js");
  assert.equal(limited.status, "resource-limit");
  assert.equal(createSyntaxAnalyzer({ directory: null, maxBytes: 1 })(Buffer.from("ab"), "x.js").status, "resource-limit");
  for (const [syntax, expected] of [[bad, "parse-error"], [limited, "resource-limit"], [null, "missing-content"]]) {
    const side = analyzeSnapshot(Buffer.from("function f() {}"), "x.js", { syntax })["cyclomatic-complexity"];
    assert.equal(side.status, expected);
    assert.equal(side.value, null);
    assert.equal(side.eligible, 1);
  }
  assert.equal(analyzeSnapshot(Buffer.alloc(0), "x.js", { syntax: analyze(null, "x.js") })["cyclomatic-complexity"].value, 0);
  const timed = createSyntaxAnalyzer({ directory: null, maxParseMilliseconds: 1 })(
    Buffer.from(`function f() { ${"if (x) return;".repeat(100_000)} }`), "x.js");
  assert.equal(timed.status, "resource-limit");
  assert.match(timed.reason, /time budget/);
});

test("Content cache reuses paths and fresh processes, distinguishes dialects/bytes and rejects corruption", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "syntax-cache-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let calls = 0;
  const cached = createSyntaxAnalyzer({ directory, onParse: () => calls++ });
  const code = Buffer.from("function f(x) { if (x) return 1; }");
  const first = cached(code, "one.js");
  assert.strictEqual(cached(code, "other.mjs"), first);
  assert.equal(calls, 1);
  cached(code, "x.ts"); cached(Buffer.from(`${code}\n`), "x.js");
  assert.equal(calls, 3);
  const script = `import { createSyntaxAnalyzer } from ${JSON.stringify(new URL("../src/syntax/analyzer.mjs", import.meta.url).href)};
    const a=createSyntaxAnalyzer({directory:process.argv[1],onParse:()=>{throw new Error("unexpected parse")}});
    console.log(a(Buffer.from(${JSON.stringify(code.toString())}),"fresh.js").id);`;
  assert.equal(execFileSync(process.execPath, ["--input-type=module", "-e", script, directory], { encoding: "utf8" }).trim(), first.id);
  const filename = readdirSync(directory).find((name) => JSON.parse(readFileSync(join(directory, name))).id === first.id);
  assert.equal(statSync(join(directory, filename)).mode & 0o777, 0o600);
  const tiny = createSyntaxAnalyzer({ directory, maxNodes: 1 });
  assert.equal(tiny(code, "x.js").status, "resource-limit");
  const saved = JSON.parse(readFileSync(join(directory, filename)));
  saved.nodes[0][0] = 9999;
  writeFileSync(join(directory, filename), JSON.stringify(saved));
  assert.throws(() => createSyntaxAnalyzer({ directory })(code, "x.js"), /identity mismatch/);
});

test("Report AST tables deduplicate scope references, round-trip offline and reject missing references", async (t) => {
  const syntax = parse("x.js", samples[0][1]);
  const record = { path: "x.js", status: "modified", additions: 1, deletions: 1, syntax: { before: syntax, after: syntax } };
  const report = createReport({ source: { kind: "fixture" }, title: "Syntax", comparison: {},
    files: [record], commits: [{ sha: "one", files: [record] }], layers: [{ id: "index", files: [record] }] });
  assert.equal(Object.keys(report.syntaxSnapshots).length, 1);
  assert.deepEqual(report.metrics.fileMetrics[0].syntax.after, { id: syntax.id, status: "available" });
  assert.equal(report.structuralAnalysis.coverage.available, 6);
  const directory = mkdtempSync(join(tmpdir(), "syntax-report-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  await saveReport(directory, report);
  assert.deepEqual(await loadReport(directory, report.id), report);
  const { id, ...content } = report;
  delete content.syntaxSnapshots[syntax.id];
  const broken = { ...content, id: digest(JSON.stringify(content)) };
  await assert.rejects(saveReport(directory, broken), /syntax reference/);
});

test("Missing syntax does not become zero and parse errors remain eligible in partial aggregates", () => {
  const side = (text) => analyzeSnapshot(Buffer.from(text), "x.js", { syntax: parse("x.js", text) })["cyclomatic-complexity"];
  const valid = side("function f(x) { if(x) return; }");
  const invalid = side("function f(");
  const metrics = measure([
    { path: "a.js", status: "modified", additions: 1, deletions: 1,
      alternativeMetrics: { "cyclomatic-complexity": { version: 1, before: valid, after: valid } } },
    { path: "b.js", status: "modified", additions: 1, deletions: 1,
      alternativeMetrics: { "cyclomatic-complexity": { version: 1, before: invalid, after: invalid } } },
  ]);
  assert.equal(metrics.alternativeMetrics["cyclomatic-complexity"].after.status, "partial");
  assert.equal(metrics.alternativeMetrics["cyclomatic-complexity"].after.value, 2);
  assert.equal(metrics.alternativeMetrics["cyclomatic-complexity"].after.eligible, 2);
  const old = measure([{ path: "x.js", status: "modified", additions: 1, deletions: 1 }]);
  assert.equal(old.alternativeMetrics["cyclomatic-complexity"].after.value, null);
});
