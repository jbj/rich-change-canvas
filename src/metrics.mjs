export function languageForPath(path) {
  for (const [language, pattern] of [
    ["JavaScript", /\.[cm]?jsx?$/], ["TypeScript", /\.[cm]?tsx?$/],
    ["Python", /\.pyi?$/], ["Go", /\.go$/], ["Rust", /\.rs$/], ["Java", /\.java$/],
    ["C/C++", /\.(c|h|cc|cpp|cxx|hpp)$/], ["Kotlin", /\.kts?$/],
    ["Shell", /\.(sh|bash)$/], ["SQL", /\.sql$/],
  ]) if (pattern.test(path)) return language;
  return null;
}

export function classify(path, binary = false) {
  const name = path.split("/").at(-1);
  const rule = (category, reason) => ({ category, reason });
  if (binary) return rule("binary", "Blob bytes contain NUL or fail UTF-8 decoding");
  if (/^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|uv\.lock|go\.sum|Pipfile\.lock|Gemfile\.lock)$/.test(name)) {
    return rule("lockfile", "Recognized lockfile basename");
  }
  if (/(^|\/)(__snapshots__|snapshots)\/|\.(snap|shot)$|\.snap\.|(^|\/)baselines\/reference\//.test(path) ||
      /\/test\/fixtures\/.*\/output\.(json|js|ts)$/.test(path)) {
    return rule("snapshot", "Snapshot directory or extension");
  }
  if (/(^|\/)(testFixtures|test-fixtures)\//.test(path)) {
    return rule("test-support", "Dedicated test-support source directory");
  }
  if (/(^|\/)(fixtures?|__fixtures__|testdata|test_data|test-files|test_files)\//i.test(path)) {
    return rule("fixture", "Recognized test-input directory");
  }
  if (/^tests\/format\//.test(path) && !/(^|\/)format\.test\.[cm]?[jt]s$/.test(path)) {
    return rule("fixture", "Prettier formatter input outside its test harness");
  }
  if (/(^|\/)(tests?|testing|__tests__|integration-tests|test-integration)\//i.test(path) ||
      /(^|\/)test_[^/]+\.py$|_test\.go$|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)[^/]*(Test|Tests|TestCase)\.java$/.test(path)) {
    return rule("test", "Test directory or language-specific test filename");
  }
  if (/(^|\/)(docs?|documentation|changelog_unreleased)\//i.test(path) ||
      /\.(md|mdx|rst|adoc)$/.test(path) ||
      /^(README|CHANGELOG|CONTRIBUTING|AUTHORS|LICENSE|COPYING)(\.|$)/i.test(name)) {
    return rule("documentation", "Documentation directory, basename, or extension");
  }
  if (/^(package\.json|Cargo\.toml|go\.mod|pyproject\.toml|setup\.py|setup\.cfg|pom\.xml|build\.gradle(\.kts)?|requirements[^/]*\.txt)$/.test(name)) {
    return rule("manifest", "Dependency/build manifest basename");
  }
  if (/(\.pb\.go|\.generated\.[^/]+|\.gen\.[^/]+)$/.test(path) || /(^|\/)(generated|gen)\//.test(path)) {
    return rule("generated", "Explicit generated directory or filename convention");
  }
  if (/\.(c|h|cc|cpp|cxx|hpp|m|mm|[cm]?[jt]sx?|pyi?|go|rs|java|kt|kts|scala|rb|sh|bash|sql|swift|vue|svelte)$/.test(path)) {
    return rule("source", "Recognized code extension outside more-specific roles");
  }
  if (/(^|\/)\.github\/|\.(ya?ml|toml|json|xml|ini|cfg|conf|properties)$|(^|\/)(Makefile|Dockerfile|\.gitignore|\.gitattributes)$/.test(path)) {
    return rule("configuration", "Configuration directory, extension, or basename");
  }
  return rule("other", "No explicit role rule matched; inspect instead of guessing");
}

export function measure(files) {
  const categories = {};
  const measuredFiles = files.map((file) => {
    if (typeof file.path !== "string" ||
        !Number.isSafeInteger(file.additions) || file.additions < 0 ||
        !Number.isSafeInteger(file.deletions) || file.deletions < 0) {
      throw new Error("File metrics require a path and nonnegative integer line counts");
    }
    const role = classify(file.path, file.binary);
    categories[role.category] ??= { files: 0, additions: 0, deletions: 0, beforeBytes: 0, afterBytes: 0 };
    const group = categories[role.category];
    group.files++;
    group.additions += file.additions;
    group.deletions += file.deletions;
    if (file.binary) {
      if ((!Number.isSafeInteger(file.beforeBytes) || file.beforeBytes < 0) && file.status !== "added") throw new Error(`Missing before size: ${file.path}`);
      if ((!Number.isSafeInteger(file.afterBytes) || file.afterBytes < 0) && file.status !== "removed") throw new Error(`Missing after size: ${file.path}`);
      group.beforeBytes += file.beforeBytes ?? 0;
      group.afterBytes += file.afterBytes ?? 0;
    }
    return { ...file, ...role, language: languageForPath(file.path), churn: file.additions + file.deletions };
  });
  const additions = measuredFiles.reduce((sum, file) => sum + file.additions, 0);
  const deletions = measuredFiles.reduce((sum, file) => sum + file.deletions, 0);
  const testRoles = new Set(["test", "test-support", "fixture", "snapshot"]);
  const supportChurn = measuredFiles.filter((file) => testRoles.has(file.category))
    .reduce((sum, file) => sum + file.churn, 0);
  const sourceChurn = (categories.source?.additions ?? 0) + (categories.source?.deletions ?? 0);
  const incomplete = measuredFiles.filter((file) => file.patchState === "missing-or-truncated").length;
  const otherFiles = categories.other?.files ?? 0;
  const addedRustTestAttributes = files.reduce((sum, file) => sum + (file.addedRustTestAttributes ?? 0), 0);
  const removedRustTestAttributes = files.reduce((sum, file) => sum + (file.removedRustTestAttributes ?? 0), 0);
  const observations = [];
  if (incomplete) observations.push(`${incomplete} missing or truncated text patches`);
  if (otherFiles) observations.push(`${otherFiles} files with unclassified roles`);
  if (sourceChurn && !supportChurn) observations.push("Source changes; no separate test/support/fixture/snapshot line changes");
  if (!sourceChurn && supportChurn) observations.push("Test/support/fixture/snapshot changes without recognized source-line changes");
  if (categories.manifest) observations.push(`${categories.manifest.files} dependency/build manifest files changed`);
  if (categories.binary) observations.push(`${categories.binary.files} binary files changed`);
  const renames = measuredFiles.filter((file) => file.status === "renamed").length;
  if (renames) observations.push(`${renames} files renamed`);
  if (addedRustTestAttributes || removedRustTestAttributes) {
    observations.push(`Rust test-attribute patch lines: +${addedRustTestAttributes} / -${removedRustTestAttributes}; lexical evidence, not tests run`);
  }
  return {
    files: measuredFiles.length, additions, deletions, churn: additions + deletions,
    sourceChurn, supportChurn, categories, fileMetrics: measuredFiles,
    incomplete, otherFiles, observations,
    largestFileChurn: measuredFiles.reduce((largest, file) => Math.max(largest, file.churn), 0),
    binaryFiles: categories.binary?.files ?? 0,
    addedRustTestAttributes, removedRustTestAttributes,
    renames,
  };
}
