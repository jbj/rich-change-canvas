export function languageForPath(path) {
  for (const [language, pattern] of [
    ["JavaScript", /\.[cm]?jsx?$/], ["TypeScript", /\.[cm]?tsx?$/],
    ["Python", /\.pyi?$/], ["Go", /\.go$/], ["Rust", /\.rs$/], ["Java", /\.java$/],
    ["C/C++", /\.(c|h|cc|cpp|cxx|hpp)$/], ["Kotlin", /\.kts?$/],
    ["Shell", /\.(sh|bash)$/], ["SQL", /\.sql$/],
  ]) if (pattern.test(path)) return language;
  return null;
}

const BINARY_EXTENSIONS = /\.(png|jpe?g|gif|webp|avif|bmp|ico|icns|cur|tiff?|psd|ai|pdf|woff2?|ttf|otf|eot|ttc|mp3|mp4|m4a|wav|ogg|oga|webm|mov|avi|flac|zip|gz|tgz|bz2|xz|zst|7z|tar|jar|war|ear|class|wasm|so|dylib|dll|exe|a|o|lib|obj|pyc|mo|pgo|bin|keystore|jks|p12|pfx|der|sqlite3?|db|npy|npz|parquet|pkl|pickle|xlsx?|docx?|pptx?|odt)$/i;
const SOURCE_EXTENSIONS = /\.(c|h|cc|cpp|cxx|hpp|hh|hxx|inc|ipp|def|m|mm|[cm]?[jt]sx?|pyi?|pyx|pxd|pxi|go|rs|java|kt|kts|scala|groovy|clj|cljs|rb|php|pl|pm|lua|cs|fs|vb|swift|dart|ex|exs|erl|hrl|hs|ml|mli|elm|zig|nim|jl|r|coffee|vue|svelte|astro|sh|bash|zsh|fish|ps1|psm1|bat|cmd|awk|vim|el|sql|s|asm|wat|tq|proto|thrift|fbs|graphql|gql|g4|y|yy|l|ll|jflex|flex)$/i;

export function classify(path, binary = false) {
  const name = path.split("/").at(-1);
  const rule = (category, reason) => ({ category, reason });
  if (binary) return rule("binary", "Blob bytes contain NUL or fail UTF-8 decoding");
  if (BINARY_EXTENSIONS.test(name)) return rule("binary", "Binary media, archive, or compiled-file extension");
  if (/^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|uv\.lock|go\.sum|go\.work\.sum|Pipfile\.lock|Gemfile\.lock|composer\.lock|bun\.lockb?|[^/]+\.lock)$/.test(name) ||
      /(^|\/)licenses\/[^/]+\.(sha1|sha256|sha512)$/.test(path)) {
    return rule("lockfile", "Recognized lockfile basename or pinned dependency checksum");
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
  if (/(^|\/)(tests?|testing|__tests__|integration-tests|test-integration|e2e|qa)\//i.test(path) ||
      /(^|\/)src\/[a-z][A-Za-z]*Test\//.test(path) ||
      /(^|\/)test_[^/]+\.py$|_test\.go$|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)[^/]*(Test|Tests|TestCase)\.java$/.test(path)) {
    return rule("test", "Test directory, test source set, or language-specific test filename");
  }
  if (/(^|\/)(docs?|documentation|changelog_unreleased)\//i.test(path) ||
      /(^|\/)(LICENSES|licenses|man)\//.test(path) && !SOURCE_EXTENSIONS.test(name) ||
      /\.(md|mdx|rst|adoc|txt\.md|[1-9])$/.test(name) || /^(CITATION(\.cff)?|\.?mailmap)$/.test(name) ||
      /^(README|CHANGELOG|CHANGES|HISTORY|CONTRIBUTING|CONTRIBUTORS|AUTHORS|MAINTAINERS|LICEN[CS]E|COPYING|NOTICES?|INSTALL|SECURITY|CODE_OF_CONDUCT|PATENTS|ThirdPartyNotices)(\.(md|markdown|txt|rst|adoc|html?))?$/i.test(name) ||
      /^(LICEN[CS]E|COPYING|NOTICE)[-_.][^/]+$/.test(name)) {
    return rule("documentation", "Documentation or legal directory, basename, or extension");
  }
  if (/^(package\.json|Cargo\.toml|go\.mod|go\.work|pyproject\.toml|setup\.py|setup\.cfg|MANIFEST\.in|pom\.xml|requirements[^/]*\.(txt|in)|Gemfile|composer\.json|[^/]*\.gradle(\.kts)?|gradle\.properties|gradlew(\.bat)?|CMakeLists\.txt|meson\.build|meson_options\.txt|BUILD(\.bazel)?|WORKSPACE(\.bazel)?|MODULE\.bazel|BUCK|(GNU)?[Mm]akefile(\.(?!([^/]*\.)?[cm]?[jt]s$)[^/]*)?|build\.info|[^/]*\.(bzl|bazel|gn|gni|gyp|gypi|mk|cmake|m4|wrap|csproj|fsproj|vcxproj|sln|wixproj|patch|diff))$/.test(name)) {
    return rule("manifest", "Dependency/build manifest, build script, or dependency patch");
  }
  if (/(\.pb\.go|\.generated\.[^/]+|\.gen\.[^/]+)$/.test(path) || /(^|\/)(generated|gen)\//.test(path)) {
    return rule("generated", "Explicit generated directory or filename convention");
  }
  if (/\.(po|pot|isl|xlf|xliff|arb|resx|strings|ftl)$/i.test(name) || /(^|\/)(locales?|i18n|l10n)\/[^/]+\.json$/.test(path)) {
    return rule("localization", "Translation catalog extension or locale directory");
  }
  if (SOURCE_EXTENSIONS.test(name)) {
    return rule("source", "Recognized code extension outside more-specific roles");
  }
  if (/\.(java|py|go|rs|[cm]?[jt]sx?|c|h|cpp|kt|rb|sh)\.(st|tpl|tmpl|jte|txt|template)$|\.(py|rs|go|java)-tpl$/i.test(name)) {
    return rule("source", "Code-generation template for a recognized language");
  }
  if (/(^|\/)(bin|scripts?|\.husky|hooks|githooks)\/[^/.]+$/.test(path) || /(^|\/)docker[^/]*\/.*\/[^/.]+$/.test(path) && !/^[A-Z][A-Z_]+$/.test(name)) {
    return rule("source", "Extensionless file in a script, hook, or binary directory");
  }
  if (/\.(html?|xhtml|css|scss|sass|less|styl|sss|pcss|svg|xsl|xslt|ejs|hbs|handlebars|mustache|njk|jinja2?|j2|liquid|twig|tpl|kml)$/i.test(name)) {
    return rule("markup", "Markup, stylesheet, vector image, or template extension");
  }
  if (/\.(csv|tsv|psv|dat|dic|ndjson|jsonl|geojson|csv-spec|sql-spec)$/i.test(name)) {
    return rule("data", "Tabular or line-oriented data extension");
  }
  if (/(^|\/)\.github\/|\.(ya?ml|toml|json|jsonc|json5|xml|ini|cfg|conf|properties|prefs|env|editorconfig|code-snippets|code-workspace|defconfig|ld|lds|alg|plist|sublime-project|wxs|nuspec|config)$/.test(path) ||
      /(^|\/)META-INF\/services\//.test(path) ||
      /^(\.[^/]*(ignore|rc|attributes|modules|keep|-blame-ignore-revs)|\.env(\..+)?|_gitignore|Dockerfile([.-][^/]*)?|Containerfile|Procfile|Vagrantfile|Jenkinsfile|CODEOWNERS|OWNERS|DIR_METADATA|CNAME|_redirects|_headers|\.nojekyll|py\.typed|\.coveragerc|\.flake8|\.pylintrc|\.dockerignore|\.gitmodules|\.npmrc|\.nvmrc|\.node-version|\.python-version|rust-toolchain(\.toml)?|rust-version)$/.test(name)) {
    return rule("configuration", "Configuration directory, extension, or basename");
  }
  const wrapped = /^(.+\.[^/.]+)\.(in|template|tmpl|example|sample|dist|orig)$/.exec(path);
  if (wrapped) {
    const inner = classify(wrapped[1]);
    if (inner.category !== "other") return rule(inner.category, `${inner.reason} (.${wrapped[2]} wrapper)`);
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
