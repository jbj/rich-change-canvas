# Rich change summaries

A compact, read-only Copilot App canvas and standalone dashboard that help
reviewers understand a change between a diffstat and the full diff.

The current study covers **30 merged PRs from 30 projects in six languages**,
with **1,011 changed files and 61 individually inspectable commits**. Each sample
has at most two human discussion entries, a non-author human approval on its head
before merge, and a maintainer approval. Bot activity is reported separately.
This is a convenience sample, not a validated approval classifier.

## Build, distribute, install, and update in Copilot App

**Current delivery model: a full repository checkout with a project-local
extension, not a standalone extension package.** There is no build step,
published npm package, or release installer. Node.js source runs directly;
the Tree-sitter runtime and grammars use pinned, prebuilt WASM assets.

### Install and open

Use Node.js **22 or newer**, Git, and a GitHub Copilot App version that supports
canvas extensions. Clone the complete repository and install its dependencies:

```sh
git clone https://github.com/jbj/rich-change-canvas.git
cd rich-change-canvas
npm ci --ignore-scripts --omit=optional
# In a configured CFS environment, replace the install command with:
# gh cfs -- npm ci --ignore-scripts --omit=optional
```

Add/open this checkout as a repository in Copilot App and start a project
session. Ask Copilot to **reload extensions**, confirm that
`rich-change-review` loaded using the extension list/inspect tools, then ask
it to **open the Rich change review canvas**. The App discovers
`.github/extensions/rich-change-review/extension.mjs` and supplies
`@github/copilot-sdk`; it does **not** install the npm dependencies for you.
Missing packages or WASM assets prevent the provider from loading.

The canvas analyzes the Git checkout containing the extension, not an arbitrary
repository selected elsewhere in the App. It normally compares against the
default branch; see [opening the review](#open-the-review-in-github-copilot)
for baseline and authentication requirements. To analyze other repositories
without deploying code into them, use the [standalone CLI](#analyze-your-own-changes).

### Distribute

For now, share the **complete repository** at a known branch, tag, or commit,
and have recipients install dependencies as above. A source archive must
retain hidden directories, including `.github/`, and be placed in the Git
checkout to be analyzed. Copying only the extension folder, or using the
App's extension-folder/gist installer, is **not sufficient**: the entrypoint
imports `src/` and `web/` outside that folder, and needs runtime/grammar assets
from `node_modules/`.

A future portable release must bundle those modules, web assets, runtime
JavaScript/WASM, grammar WASM, and license notices while preserving asset
resolution. That bundler is not implemented. The current dependency install
is approximately **85 MiB**; WASM avoids native compilation, but does not
remove dependency installation or distribution requirements. See
[distribution details](docs/syntax.md#installation-and-extension-distribution).

### Update

In a clean installed checkout tracking the desired branch:

```sh
git pull --ff-only
npm ci --ignore-scripts --omit=optional
# Configured CFS environment: gh cfs -- npm ci --ignore-scripts --omit=optional
```

For a pinned installation, check out the desired new tag/commit instead of
pulling, then run the same dependency installation. Preserve any local changes
before updating. In each active Copilot App session, ask Copilot to **reload
extensions**, confirm the provider loaded, and reopen the review with a
**fresh canvas instance**. Updating files or refreshing the existing page alone
does not replace imported modules or guarantee a newly collected report.

## Analyze your own changes

The standalone analyzer and browser UI work now, without a native extension.
They require Node.js 22 or newer and Git. GitHub acquisition also requires
authenticated `gh` with access to the target repository.

Install pinned dependencies first (no native compilation or lifecycle scripts):

```sh
npm ci --ignore-scripts --omit=optional
# In a configured CFS environment: gh cfs -- npm ci --ignore-scripts --omit=optional
```

The lockfile pins integrity hashes without registry-specific download URLs;
installation uses the caller's configured registry. Runtime does not download
grammars. Node.js source still runs directly, without a build.

```sh
# Merge-base-to-HEAD, each original commit, and separate mutable local layers.
node cli.mjs local --base HEAD~1 --working --out /tmp/change-reports

# Public or accessible private PR, with individually inspectable commits.
node cli.mjs pr --repository prettier/prettier --number 20459 --out /tmp/pr-reports

# Reopen or compare previously collected reports, without network access.
node cli.mjs view --input /tmp/change-reports/<report-id>.json \
  --input /tmp/pr-reports/<report-id>.json --out /tmp/review-desk
open /tmp/review-desk/review.html
```

Choose an output directory **outside the analyzed repository**. Each acquisition
writes a versioned, SHA-256-identified JSON report and a self-contained
`review.html`. New CLI reports include inline text diffs as well as filenames,
counts, commit subjects and revision identifiers. Local reports also contain the
repository's absolute path. Treat reports from private repositories as private.
Saved content identity is verified when saving and reopening; it detects
accidental edits, not the authenticity of the producer.

New reports retain before/after metric evidence and deduplicated source-anchored
syntax trees for JavaScript/JSX, TypeScript/TSX, Python, Go, Rust, and Java.
GitHub acquisition
fetches full blobs, even for complete text patches. Source reads are batched
through GraphQL to avoid one REST request per file version, with REST blob
fallback for binary/truncated content. Up to eight authenticated source reads
run concurrently (batched together where possible). Responses, including source bytes, are
cached under `~/.cache/rich-change-canvas/github-v1` with owner-only permissions.
An identical subsequent acquisition uses the cache without GitHub requests or
an authentication check. Authentication is checked before the first cache miss;
use `gh auth login` if needed. The cache has no automatic expiry: PR commands
replay the cached acquisition rather than refreshing mutable metadata. Remove
that cache directory explicitly to reacquire current PR data. Keep private
repository caches, reports, and HTML private.

Measurements are reused by revision/path across scopes. Parsed trees additionally
reuse a private, content-addressed disk cache under
`~/.cache/rich-change-canvas/syntax-v1` across local and GitHub acquisitions.
Full source snapshots are not embedded in reports, but syntax identifiers,
operators, node ranges, and changed/context lines are. Both sides of every existing file version
must be accessible; acquisition errors remain explicit rather than producing
incomplete success-shaped results.

The **change review dashboard** puts scope controls, coloured line deltas,
numeric role summaries, and collapsible commits on one compact screen, without tabs.
Expand a role to see its file list in the same diffstat columns; expand a file
to display its diff inline, with a GitHub link when available. Visible rows share
content-sized columns: paths on the left, then right-aligned stats and charts,
then any unused space on the right. Expanding or collapsing a role recalculates
these widths. Paths shrink first, using middle truncation; stats only wrap once
the path column reaches roughly ten visible characters plus the ellipsis.
At viewports smaller than all column minimums combined, avoiding overflow takes
precedence over that minimum. Paths stay on one line when truncated;
the complete path remains in the accessible label and hover title. Text diffs
already include their filenames, so no additional filename heading is added.
Files without a displayable text patch retain full current/previous paths in
their expanded details. File-status labels beside filenames and zero binary-file totals
are omitted. Text actions consistently underline on hover or keyboard focus,
without a hover background.
Diffs preserve formatting with local horizontal scrolling by default.
**Wrap lines** wraps long code and unbroken tokens without changing patch text;
the choice applies to other open and newly opened diffs for that page session.
Diff regions are keyboard-focusable and scroll independently. The live canvas
loads local diffs on demand up to 256 KiB; CLI reports embed diffs for committed,
original-commit, and requested working scopes so they work offline.
Expand Original commits to select a commit and update the same overview;
scope selectors keep that overview in place. Report comparison and search/shape
filters are available in an expandable section when there are multiple reports
or non-empty local layers.
Diffstats and commit summaries show numbers only, with no Churn column.
Whole-file snapshot metrics retain before/after bars on a linear scale.
Repository text uses sans serif typography, while fixed headings and counts are
monospaced. The dashboard follows the system colour scheme and stacks in narrow
panels.

Staged, unstaged, and untracked layers are independent snapshots,
not part of the committed footprint. A merge's first-parent view is explicitly
labeled merge context. Binary changes use before/after bytes, including renames;
missing or truncated GitHub patches are reconstructed from exact before/after
blobs and checked against recorded line totals. Acquisition fails if they
cannot be reconciled. Older reports can still show incomplete patches.
A zero-line rename still counts
as a changed file.

Acquisition fails explicitly on stale inputs, unsupported non-file entries,
inconsistent API totals, or collection limits. Defaults are 250 commits, 3,000
files per local scope, and 16 MiB per fetched blob; individual commands also
have a 120-second timeout and 128 MiB output budget. GitHub's file API caps and
missing blobs can prevent complete acquisition. Blob classification uses NUL
bytes or failed strict UTF-8 decoding. No repository programs, filters, builds,
or workflows are executed; Git external diffs and text conversion are disabled.

The analyzer provides **file/snapshot, lexical, and syntactic evidence**, not
semantic equivalence or test coverage. Cyclomatic complexity appears in the
**Syntax** metric group; it sums per-function values for each before/after
snapshot. A parse error makes that side unavailable, not zero. Unsupported
file types and binary content are excluded. GitHub discussion totals in new
reports include bots and do not claim verified human approvals; the curated
study below has separate, stronger review-selection evidence.

## Selectable metrics

Use **Metric** next to Scope to switch the existing totals, role table, expanded
file rows, and bars. Added/deleted text lines remain the default. Metric changes
preserve expanded roles; report/scope changes preserve the metric selection.
Original-commit counts and Compare reports remain explicitly labeled
text-line navigation summaries.

Additive line/occurrence metrics show a **diffstat: +added / −removed**, with
coloured numbers and no bars. These are counts of
qualifying changed lines or occurrences, not net differences between whole-file
totals. Replacing one long line with seven long lines shows **+7 / −1**, not
+6. Replacing a long line with a different long line shows **+1 / −1**.
Zero sides are omitted: **+48** instead of +48 / −0. Fully measured zero-only
file and role rows are hidden for the selected diffstat metric. Binary and
rename/copy-only changes remain visible in the text-line/churn views with
neutral **±0** instead of +0 / −0. Summaries also use ±0 for zero totals.
Unavailable or partial measurements are never hidden as measured zeros.
Files where a metric does not apply are omitted, along with empty role groups;
an entirely inapplicable scope is labeled "Not applicable", not a signed N/A.
Commit navigation stays available even when a commit has no text-line changes.

Bytes, averages, maxima, and repeated lines retain whole-file before → after
values and a signed delta. Their neutral bars show before on top and after
underneath, with a shared linear scale. Repetition depends on surrounding
lines, so its counts cannot be measured from isolated changed lines. No metric
is a quality score; none of the built-in metrics uses percentages.

| Language-independent metric | Definition / role and scope aggregation |
|---|---|
| Byte size | Full blob bytes, including binary files; sum. Not compiled program size. |
| Blank lines | Whitespace-only physical lines added/removed. |
| Mean line length | Unicode code points / physical lines, excluding LF/CRLF terminators; weighted mean. |
| Maximum line length | Maximum code points on a physical line; maximum, not sum. |
| Long lines | Added/removed lines longer than 120 Unicode code points. |
| Trailing-whitespace lines | Added/removed lines ending in a space or tab. |
| Maximum textual indentation | Leading space/tab columns on nonblank lines; tabs advance to four-column stops. Not syntax nesting. |
| Repeated lines | Whole-file counts of occurrences beyond the first of trimmed nonblank lines **within each file**; sum. Not code-clone detection. |
| Text churn | Absolute added/removed text lines in the selected scope, including blanks and comments. |

Counts sum across files and roles; mean line length remains weighted by physical
line counts, and maxima use the maximum rather than a sum. Empty files have zero
bytes and zero counts/maxima, but no defined mean line length.
A final newline does not create an extra physical line. Empty additions
and removals use an empty snapshot for the absent side. Binary/non-UTF-8
snapshots support bytes but not text metrics. Zero-line renames have zero
added/removed qualifying lines, even when a new language suffix changes how the
whole-file snapshots would be interpreted.

The **Regex heuristic** group supports JavaScript, TypeScript, Python, Go, Rust,
and Java:

| Regex metric | What is counted |
|---|---|
| Comment-looking lines | Added/removed lines starting with Python `#` or other languages' `//`, `/*`, `*`, `*/`. Python docstrings are excluded. |
| Decision keywords | Added/removed `if`, `for`, `while`, language-specific `case`/`catch`/`except`/`match`/`select`, boolean operators, and JS/TS `??`. Ternary punctuation is excluded. **Not cyclomatic complexity.** |
| Declaration-like lines | Added/removed lines matching language-specific function/type declaration patterns. JS/TS methods and arrows are excluded; Java methods require a modifier. Not an exact symbol count. |
| Import-like lines | Added/removed import/from/use/require directives; grouped/multiline imports may count only their opening line. Not semantic coupling. |
| Test markers | Added/removed JS/TS test/it/describe calls, Python test definitions, Go Test/Benchmark/Fuzz functions, Rust test attributes, Java test annotations. Not test execution or coverage. |

These are intentionally simple regexes, not a lexer: strings, comments,
multiline declarations, macros, and language variants can produce false
positives and negatives. The selected metric displays its definition and
limitations. Full-snapshot totals are retained separately from changed-line
counts and from the retained research corpus's Rust patch-line evidence.

Coverage reports measured/eligible files independently for additions/removals
or before/after snapshots, as appropriate.
Unsupported languages and binary text snapshots are excluded; missing source
is unavailable, not zero. Partial aggregates are marked **partial**. Older
saved reports cannot recover content-based metrics offline: reacquire the
changes for those measurements. The corpus command acquires the retained
revisions automatically, then replays them from cache. Previously saved share
metrics migrate to absolute whole-file counts using their retained numerators.
Those counts do **not** reconstruct added/removed lines. When complete changed
patch lines are unavailable, the UI shows unavailable diffstat evidence and any
known whole-file counts instead of inventing changes from the net delta.
Known change metadata still supports absolute text churn and recorded byte
sizes. Rendering an old report does not change its saved content or immutable
identity.

**All** still combines independent committed/staged/unstaged/untracked snapshot
comparisons, not a reconstructed net diff. Paths and file versions can repeat;
its metric aggregates are over those comparisons, not unique repository files.

### In-repository metric plugins

`src/metric-plugins/` is the isolated language-independent plugin layer. Its
modules only import siblings: no Git/GitHub, filesystem, report/UI, language
detection, or regex-language dependencies. `index.mjs` explicitly registers
trusted checked-in plugins; analyzed repositories cannot supply executable
plugins. No external plugin loader or package installation is involved.

Each content plugin declares `id`, `version`, `label`, `unit`, `description`,
`tier`, `mode`, `textOnly`, `reducer`, and a pure `measure(snapshot)` function.
Use `mode: "diffstat"` for additive measures that can also be evaluated on
isolated changed lines; otherwise use `mode: "snapshot"`. For example:

```js
export const nonblank = {
  id: "nonblank-lines", version: 1, label: "Nonblank lines", unit: "lines",
  description: "Nonblank physical lines; not statements or semantic LoC.",
  tier: "Language-independent", mode: "diffstat", textOnly: true, reducer: "sum",
  measure: ({ shape }) => ({
    numerator: shape.lines.length - shape.blank,
    denominator: 1,
  }),
};
```

Import it into `snapshotPlugins` in `src/metric-plugins/index.mjs`; the catalog
and metric picker are derived automatically. Available reducers are `sum`,
`max`, `mean` (sum numerator / sum denominator), and `ratio` (the same, × 100).
`snapshot.bytes` and prepared `snapshot.shape` are ephemeral; return only finite,
nonnegative scalar sufficient statistics, never text or identifiers. Add
focused fixtures in `test/metric-plugins.test.mjs`, including empty input and
aggregation. Bump the plugin version when its definition changes. Recomputing
with a different version marks incompatible saved evidence unavailable and
requires reacquisition. Explicit `legacy` mappings can migrate old ratio
numerators to absolute counts without claiming new changed-line evidence.

`changePlugins` handles absolute counts already present in change metadata.
The pure unified-diff parser also lives in `src/metric-plugins/`; adapters supply
patch text for measurement; numeric evidence and inline diffs are stored separately. The separate
`src/regex-metrics/` provider uses the same snapshot protocol but owns its
language rules. `src/metric-analysis.mjs` binds providers, availability,
aggregation and serializable metadata; acquisition and the UI do not contain
metric-specific formulas.

### Syntax foundation

Tree-sitter parses complete before/after snapshots, including original commits
and each mutable local layer. Reports embed a deduplicated AST table retaining
concrete grammar structure plus normalized function/decision tags. Source hashes,
UTF-8 byte ranges, UTF-16 indices, and fields anchor queries to exact text.
Per-function complexity evidence is retained alongside summed snapshot metrics.
The tree-diff UI and cross-version declaration matching are not implemented.

See [the syntax contract and rules](docs/syntax.md) for query examples, exact
language-specific complexity definitions, parser limits, cache invalidation,
and distribution consequences. Parsing alone cannot establish semantic
cohesion/coupling, execution time, defects, function points, or test coverage.
Halstead and maintainability-index experiments also need agreed tokenization
and formulas; they are not inferred from regex keyword counts.

## Open the review in GitHub Copilot

The project extension in `.github/extensions/rich-change-review/` opens the
same read-only dashboard as a canvas in the GitHub Copilot App. It analyzes
the current session's repository, including committed changes and separate
staged, unstaged, and untracked layers. With local layers present, the scope
selector defaults to **All**, combining the committed footprint and each local
snapshot; the committed and individual local scopes remain available. These
snapshots are independent comparisons, so All counts can repeat paths and are
not additive. The expandable comparison also shows each non-empty local layer
as a separate row. Select a scope or row to inspect its files, then expand a
role to see its file list. The baseline is resolved from
`origin/HEAD`; if that is not configured, the extension asks `gh` for the
repository's default branch and uses its locally available ref. It does not
fetch branches or execute repository code. If the default branch is not
available locally, fetch it and reopen the canvas.

For a branch whose current HEAD matches a merged GitHub PR, the canvas uses
the PR's recorded pre-merge base commit instead of today's default branch.
This preserves the original committed diff and commit scopes after merge,
squash, or rebase merging, even as the default branch advances. The recorded
base must be available locally; fetch its history if needed. Branches with
new commits after the PR was merged keep the normal default-branch comparison.

For repositories without a remote, pass an explicit baseline when opening the
canvas, for example `input: { "base": "main" }`. The project extension resolves
the checkout from its own location, not the session's artifact directory.
An explicit base bypasses merged-PR detection.

The canvas requires installed analyzer dependencies, the Copilot App extension runtime and an authenticated
`gh` installation when a usable `origin/HEAD` ref is not available or when
checking a non-default branch for a merged PR. GitHub lookup failures are
surfaced rather than silently showing a potentially empty comparison.

Run the analyzer, persistence, CLI, renderer, and corpus-replay tests:

```sh
npm test
```

GitHub Actions runs this suite on every push and pull request using Node.js 22.

### Retesting canvas changes

There is no build step: after dependency installation, the analyzer and dashboard
run directly from source. The extension caches imported modules, and the renderer
loads HTML, CSS, and JavaScript together for that module's lifetime. After
editing extension code, `src/`, or `web/`, reload extensions, confirm the
provider loaded, and reopen the canvas. A page refresh alone does not load
new code or assets.

Each open canvas holds a report snapshot. Use a fresh canvas instance to
collect new repository changes; merely focusing an existing instance does
not recollect its report. Reloading the provider also recollects reports as
instances are rehydrated.

Verify the actual rendered page and changed controls, not just a successful
canvas-open response. In particular, check that no "Unable to render report"
message appears and that scope selection displays the expected files.
See [AGENTS.md](AGENTS.md) for the agent verification procedure.

## Study data

### Browse all 30 sample PRs

Generate a self-contained gallery using the **same dashboard as the review
canvas**, not the retired research preview:

```sh
node cli.mjs corpus --input research/corpus.json --out /tmp/sample-gallery
open /tmp/sample-gallery/review.html
```

The first run requires authenticated `gh` and network access to acquire source
at the corpus's recorded immutable revisions. No sampled repository checkout
is needed, and no sampled code is executed. All implemented snapshot and
changed-line metrics are computed for all 30 PRs and their 61 original commits;
unsupported language/metric combinations remain explicitly inapplicable.
Diffs are embedded, including patches omitted by GitHub. Subsequent runs reuse
the persistent cache without requests. The output includes immutable report JSON files that can be
reopened with `node cli.mjs view --input <report-id>.json --out <directory>`.

Use **Report** to switch PRs, or expand **Compare reports** to search by
repository or title and compare footprints. Select an original commit using
**Scope** or **Original commits**; expand a role to inspect its file list.

For repeatable browser inspection, run the dependency-free development helper:

```sh
node research/browser-review.mjs /tmp/sample-gallery/review.html
```

Open the printed loopback URL in a browser. **Viewport** sets a real iframe
viewport to 480, 640, 800, 1024, or 1280 CSS pixels. **Audit all reports**
checks every report, scope, and metric, then opens each report's longest-line
diff in both wrapping modes. It checks rendering errors, page/metric overflow,
full-path access, diff containment, and exact patch text. Copy the resulting
JSON outside the repository; use browser screenshot tools for visual checks.
The audit also checks shared column alignment, intrinsic sizing, filename-first
shrink priority, trailing free space, expanded/collapsed widths, and redundant
filename headings above text diffs. `test/table-layout-fixtures.mjs` supplies
synthetic edge cases for this same browser audit.
The helper serves only the specified HTML and its inspection page on loopback,
does not modify the report or its CSP, and needs no package installation.
Stop it with Ctrl-C when finished. Layout checks complement, rather than
replace, visual and keyboard inspection and fresh-provider canvas checks.
For a quick tour, try these repositories:

| Repository | What to look at |
|---|---|
| `spf13/cobra` | A one-file, one-line source change |
| `nodejs/node` | A small test-only change |
| `babel/babel` | A tiny source change alongside inputs and snapshots |
| `microsoft/TypeScript` | 812 final changed files, snapshot-heavy work, and ten commits |
| `angular/angular` | A deletion-heavy source change |
| `elastic/elasticsearch` | 14 final changed lines versus 25,093 lines in an upstream merge context |

These retain the collection-time comparisons and review evidence, not today's
PR heads. Source bytes are fetched or loaded from cache at those exact revisions,
and reconstructed diffs must reconcile with the retained line counts. Human approval
evidence is identified separately from raw bot-inclusive comment totals. The
corpus is a convenience sample with no binary changes, not a demonstration of
every possible PR shape or evidence of correctness, coverage, or review quality.

### Retained research artifacts

The separate research preview UI and builder have been retired in favour of
the current review dashboard. The study data, probes, summary, report, and
analyzer tests remain available. `research/browser-validation.json` records
historical validation of the retired preview, not the current dashboard.

Read [the study report](research/report.md) for all 30 PR links, findings, metric
definitions, and limitations. The compact [corpus](research/corpus.json) contains
metadata, paths, counts, review provenance, and immutable commit identifiers,
not copied source files or patches.

The Python AST experiment is scoped to one production file per Python PR.
Other languages currently have file-level measurements. Binary byte-size
handling has unit-fixture validation only: the selected corpus contains no
binary changes. Low discussion, unchanged complexity, and test-line counts
do not establish safety, correctness, coverage, or runtime performance.

## Refresh the research

Acquisition requires authenticated `gh`. Keep the raw response cache outside
the repository; it includes public patch/blob data and is not part of the
compact shareable corpus.

```sh
STUDY_CACHE=/absolute/path/outside/the/repository node research/collect.mjs
python3 research/python_probe.py
node --test research/metrics.test.mjs
```

`python_probe.py` needs Python 3.13 or newer and only uses the standard library.
It parses source as data without importing or executing it. The checked-in
`python-probe.json`, corpus, and study report can be read offline;
Python and network access are not required to inspect them. Collection and the
probe update their data files; the retained summary and written report are
historical study artifacts and are not regenerated automatically.

## Re-check file-role coverage

The file-role classifier (`classify()` in `src/metrics.mjs`) is surveyed against
every file in all 30 corpus repositories at their merge commits, not only the
changed files. See [research/file-roles.md](research/file-roles.md) for the
method, results, and audit.

```sh
node research/survey-files.mjs                      # fetch trees, write research/file-survey.json
node research/compare-classifiers.mjs --base HEAD   # role transitions vs a git ref
node research/sample-classification.mjs --size 50   # seeded stratified sample to audit by hand
```
