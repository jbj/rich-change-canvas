import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, measure } from "./metrics.mjs";

test("Roles distinguish code, harnesses, inputs, and snapshots in all six languages", () => {
  for (const [path, category] of [
    ["src/index.js", "source"], ["src/index.ts", "source"],
    ["pkg/handler.go", "source"], ["lib/mod.rs", "source"],
    ["app/main.py", "source"], ["src/main/java/Example.java", "source"],
    ["test/foo.js", "test"], ["src/foo.test.ts", "test"],
    ["pkg/handler_test.go", "test"], ["tests/integration.rs", "test"],
    ["app/test_main.py", "test"], ["src/test/java/Example.java", "test"],
    ["fixtures/src/main.ts", "fixture"], ["tests/__snapshots__/a.snap", "snapshot"],
    ["fixtures/snapshots/1-Error.shot", "snapshot"], ["testdata/large.json", "fixture"],
    ["src/testFixtures/java/MockExecutor.java", "test-support"],
    ["testdata/baselines/reference/example.js", "snapshot"],
    ["packages/babel-parser/test/fixtures/case/output.json", "snapshot"],
    ["tests/format/js/binary/parens.js", "fixture"],
    ["tests/format/js/binary/format.test.js", "test"],
    ["yarn.lock", "lockfile"], ["Cargo.lock", "lockfile"],
    ["go.sum", "lockfile"], ["uv.lock", "lockfile"],
    ["pom.xml", "manifest"], ["go.mod", "manifest"],
    ["src/api.pb.go", "generated"], ["CHANGELOG.md", "documentation"],
    ["unknown.xyz", "other"],
  ]) assert.equal(classify(path).category, category, path);
});

test("Repository-wide survey rules cover web, build, translation, and data files", () => {
  for (const [path, category] of [
    ["django/contrib/admin/templates/admin/404.html", "markup"], ["src/styles.scss", "markup"],
    ["public/favicon.svg", "markup"], ["website/static/logo.png", "binary"],
    ["docs/fonts/Inter.woff2", "binary"], ["django/conf/locale/af/LC_MESSAGES/django.po", "localization"],
    ["BUILD.bazel", "manifest"], ["deps/LIEF/CMakeLists.txt", "manifest"], ["common.gypi", "manifest"],
    ["Makefile", "manifest"], ["Makefile.js", "source"], [".yarn/patches/foo.patch", "manifest"],
    ["deps/libffi/src/aarch64/sysv.S", "source"], ["pandas/_libs/algos.pyx", "source"],
    ["gradlew.bat", "manifest"], [".husky/pre-commit", "source"],
    ["LICENSE-MIT", "documentation"], ["etc/man/cargo-add.1", "documentation"],
    ["scripts/install-dependencies.js", "source"], ["internal/licenses/embed.go", "source"],
    ["server/src/main/resources/TransportVersions.csv", "data"], [".editorconfig", "configuration"],
    ["src/main/resources/META-INF/services/org.example.Plugin", "configuration"],
    ["include/config.h.in", "source"], ["licenses/antlr4-runtime-4.13.2.jar.sha1", "lockfile"],
  ]) assert.equal(classify(path).category, category, path);
});

test("JVM test source sets and packages named like test roles are not misread", () => {
  for (const [path, category] of [
    ["server/src/internalClusterTest/java/org/example/FooIT.java", "test"],
    ["x-pack/qa/rolling-upgrade/src/main/java/org/example/Upgrade.java", "test"],
    ["server/src/main/java/org/elasticsearch/snapshots/SnapshotInfo.java", "source"],
    ["compute/src/test/java/org/example/compute/data/BlockTests.java", "test"],
    ["pandas/tests/io/data/stata/stata-compat-105.dta", "fixture"],
    ["src/test/resources/golden/analysis.expected", "snapshot"],
    ["tests/ui/borrowck/borrowck-init-in-fru.stderr", "snapshot"],
    ["test/message/console_assert.out", "snapshot"],
    ["build-tools-internal/src/main/resources/deb/preinst.ftl", "markup"],
  ]) assert.equal(classify(path).category, category, path);
});

test("Empty diff is explicitly empty, not an unavailable metric", () => {
  const result = measure([]);
  assert.equal(result.churn, 0);
  assert.equal(result.largestFileChurn, 0);
  assert.equal(result.files, 0);
});

test("Zero-line renames still count as changed files", () => {
  const result = measure([{ path: "src/new.go", previousPath: "src/old.go",
    status: "renamed", additions: 0, deletions: 0, binary: false, patchState: "rename-only" }]);
  assert.equal(result.churn, 0);
  assert.equal(result.renames, 1);
  assert.equal(result.files, 1);
});

test("Binary sizes use absolute bytes, independently from text-line counts", () => {
  const result = measure([{ path: "icons/logo.png", status: "modified",
    additions: 0, deletions: 0, binary: true, beforeBytes: 100, afterBytes: 184, patchState: "binary" }]);
  assert.equal(result.categories.binary.beforeBytes, 100);
  assert.equal(result.categories.binary.afterBytes, 184);
  assert.equal(result.binaryFiles, 1);
  assert.equal(result.churn, 0);
});

test("Missing binary size is not silently converted to zero", () => {
  assert.throws(() => measure([{ path: "image.png", status: "modified",
    additions: 0, deletions: 0, binary: true, beforeBytes: null, afterBytes: 184 }]), /Missing before size/);
});

test("Incomplete text is distinct from binary and unknown role", () => {
  const result = measure([{ path: "src/main.py", status: "modified",
    additions: 3, deletions: 1, binary: false, patchState: "missing-or-truncated" }]);
  assert.equal(result.incomplete, 1);
  assert.equal(result.binaryFiles, 0);
  assert.equal(result.sourceChurn, 4);
});
