# File-role classifier coverage

`classify()` in `src/metrics.mjs` assigns every changed file a role from its path
(plus NUL-byte binary detection when contents are available). The 30 selected PRs
only touch about 1,000 files, so to check coverage we classify **every file** in
each corpus repository at the PR's `mergeCommitSha` (393,923 paths).

## Method

1. `research/survey-files.mjs` does a blobless, depth-1 fetch of each merge commit
   into a cache (default `$TMPDIR/rich-change-survey`, override with `--cache`),
   lists the tree, classifies each path without contents, and writes
   `research/file-survey.json` (category totals, per-repository shares, top
   residual extensions and directories). `--list <category|all>` prints TSV.
2. `research/compare-classifiers.mjs --base <ref>` classifies the same paths with
   `src/metrics.mjs` from a git ref and with the working tree, and prints the
   category transition table with example paths. Use it after every rule change
   to catch over-broad rules (`--from X --to Y --examples N` to drill in).
3. `research/sample-classification.mjs --size 50 --seed N` draws a stratified
   sample (floor quota per category, rest proportional, repositories round-robin)
   for manual review. Draws are ranked by a seeded hash of each path, so a sample
   only changes where a file's own category changes.

Because the survey is contents-free, binary files are recognised by extension;
those rules were added to the real classifier too.

## Results

| | before | after |
| --- | ---: | ---: |
| `other`, pooled | 3.73% | **0.28%** (1,084 files) |
| `other`, mean of per-repo shares | 4.95% | 0.22% |
| worst repository | django 38% | lucene 1.3% |

Pooled share alone is a weak target: the largest repositories are test-heavy and
dilute everyone else, so per-repository shares were tracked too.

New categories: **markup** (HTML, stylesheets, SVG, XSL, templates incl.
FreeMarker/Velocity/Jinja/Handlebars), **localization** (`.po`, `.xlf`,
`.strings`, `.arb`, `locales/*.json`, …) and **data** (`.csv`, `.tsv`,
`.ndjson`, `.dat`, …). Existing categories gained rules for binary media,
build files (Gradle, Bazel, CMake, Meson, Makefiles, patches → "Build / deps"),
more source languages and scripts, recorded outputs (`.expected`, `.stderr`,
`.stdout`, `tests/**/*.out` → snapshot), licence/man/changelog docs, dotfile
configuration, and wrapper suffixes (`.in`, `.template`, `.example`, … are
classified by the wrapped name).

Remaining residuals are mostly `.txt` (lucene stopword lists, painless
whitelists), Chromium `DEPS`, `.template`, `.tcc`, `.pem`, Perl `.t` and `.ref`
files; none is a common category on its own.

Against the 1,011 corpus PR files only 4 change role (all improvements:
`bundle.l10n.json` → localization, requests `Makefile` → build, two
Elasticsearch `snapshots/*Tests.java` → test). `summary.json` and `report.md`
predate this change.

## Audit

Three ~50-file samples were reviewed by hand while iterating.

- Seed 1 (49 files, early rules): 44 agreed. Found the `snapshots/` rule
  swallowing Elasticsearch Java packages named `snapshots` (225 files) and pandas
  `tests/**/data/` inputs left as test. Fixed: JVM package sources are excluded
  from `snapshots/` and `data/` rules; `tests?/**/data/` → fixture.
- Seed 2 (52 files): found `src/test/java/.../compute/data/*Tests.java` regressed
  to fixture (fixed by the same JVM exclusion) and Elasticsearch golden
  `*.expected` files as other (→ snapshot, 2,536 files). A later review found
  FreeMarker `.ftl` (deb `preinst.ftl`) mistaken for Fluent localization (→ markup).
- Final seed 1 (49 files, hash-ranked sampler): 45 agreed, 4 debatable, no rule
  changes made:
  - `kuromoji/.../TokenInfoDictionary$buffer.dat` → data; really a binary buffer.
  - `pandas ci/suppressions/ubsan.txt` → other; arguably configuration.
  - Kafka `src/test/resources/META-INF/services/...` → test; arguably test-support.
  - Mockito `src/testFixtures/.../AsyncTestingTest.java` → test-support; it is a
    test placed in a fixtures source set.

Rust `tests/ui/*.stderr` (16,922 files) and node `test/message/*.out` were
reclassified from test to snapshot after the sampler kept surfacing them.

Accepted debatable choices: `VERSION.dat` as data; vite `playground/*.js` as
source; babel `test/expressions/**/output.json` as test; `tests/certs/*.cnf` as
test; Java `src/test/resources` stays test (Elasticsearch keeps YAML test
definitions there); a generic `config/` directory rule was rejected because most
such directories hold autotools scripts.

## Limitations

- Path rules are heuristics tuned on these 30 repositories.
- A file with a binary extension that is actually text (e.g. an LFS pointer) is
  labelled binary but measured in lines, since byte sizes are only accumulated
  for byte-detected binaries.
