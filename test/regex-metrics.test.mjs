import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeSnapshot, compareSnapshots } from "../src/metric-analysis.mjs";

test("Six language rules count lexical declarations, comments, decisions, imports and test markers", () => {
  for (const [path, text, declarations, tests] of [
    ["x.js", "// note\nimport x from 'x';\nfunction f() { if (x && y) {} }\ntest('x', () => {});\n", 1, 1],
    ["x.ts", "// note\nimport x from 'x';\ninterface X {}\nfunction f() { if (x && y) {} }\nit('x', () => {});\n", 2, 1],
    ["x.py", "# note\nfrom x import y\ndef test_f():\n  if x and y:\n    pass\n", 1, 1],
    ["x.go", "// note\nimport \"x\"\nfunc TestF() {\n if x && y {}\n}\n", 1, 1],
    ["x.rs", "// note\nuse x::y;\n#[test]\nfn f() { if x && y {} }\n", 1, 1],
    ["X.java", "// note\nimport x.Y;\nclass X {\n @Test\n public void f() { if (x && y) {} }\n}\n", 2, 1],
  ]) {
    const result = analyzeSnapshot(Buffer.from(text), path);
    assert.equal(result["declaration-lines"].value, declarations, path);
    assert.equal(result["decision-keywords"].value, 2, path);
    assert.equal(result["import-lines"].value, 1, path);
    assert.equal(result["test-markers"].value, tests, path);
    assert.equal(result["comment-share"].numerator, 1, path);
    assert.equal(result["comment-share"].status, "available", path);
  }
});

test("Rules are explicitly lexical, do not claim parsed complexity, and exclude unsupported languages", () => {
  const result = analyzeSnapshot(Buffer.from('const s = "if while";\nconst f = () => 1;\n/*\ntext inside comment\n*/\n'), "x.js");
  assert.equal(result["decision-keywords"].value, 2);
  assert.equal(result["declaration-lines"].value, 0);
  assert.equal(result["comment-share"].numerator, 2);
  assert.equal(analyzeSnapshot(Buffer.from("if x"), "x.rb")["decision-keywords"].status, "unsupported");
  assert.equal(analyzeSnapshot(Buffer.from("if x"), "x.py")["decision-keywords"].value, 1);
  const renamed = compareSnapshots(analyzeSnapshot(Buffer.from("# note\n"), "x.py"),
    analyzeSnapshot(Buffer.from("# note\n"), "x.js"));
  assert.equal(renamed["comment-share"].before.value, 100);
  assert.equal(renamed["comment-share"].after.value, 0);
});
