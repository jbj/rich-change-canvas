# Rich change summaries

A compact, read-only Copilot App canvas and standalone dashboard that help
reviewers understand a change between a diffstat and the full diff.

The current study covers **30 merged PRs from 30 projects in six languages**,
with **1,011 changed files and 61 individually inspectable commits**. Each sample
has at most two human discussion entries, a non-author human approval on its head
before merge, and a maintainer approval. Bot activity is reported separately.
This is a convenience sample, not a validated approval classifier.

## Analyze your own changes

The standalone analyzer and browser UI work now, without a native extension.
They require Node.js 22 or newer and Git. GitHub acquisition also requires
authenticated `gh` with access to the target repository.

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
`review.html`. Reports contain filenames, counts, commit subjects and revision
identifiers, not copied source or patches. Local reports also contain the
repository's absolute path. Treat reports from private repositories as private.
Saved content identity is verified when saving and reopening; it detects
accidental edits, not the authenticity of the producer.

The **change review dashboard** puts scope controls, coloured line deltas,
miniature role bars, and collapsible commits on one compact screen, without tabs.
Expand a role to see its file list in the same diffstat columns; expand a file
to load its local diff on demand or open its GitHub diff when available. The
live canvas displays local diffs up to 256 KiB; saved reports do not embed patch
text. Expand Original commits to select a commit and update the same overview;
scope selectors keep that overview in place. Report comparison and search/shape
filters are available in an expandable section when there are multiple reports
or non-empty local layers.
Diffstat bars use a logarithmic scale; binary sizes never enter line bars.
Repository text uses sans serif typography, while fixed headings and counts are
monospaced. The dashboard follows the system colour scheme and stacks in narrow
panels.

Staged, unstaged, and untracked layers are independent snapshots,
not part of the committed footprint. A merge's first-parent view is explicitly
labeled merge context. Binary changes use before/after bytes, including renames;
missing text patches remain marked incomplete. A zero-line rename still counts
as a changed file.

Acquisition fails explicitly on stale inputs, unsupported non-file entries,
inconsistent API totals, or collection limits. Defaults are 250 commits, 3,000
files per local scope, and 16 MiB per fetched blob; individual commands also
have a 120-second timeout and 128 MiB output budget. GitHub's file API caps and
missing blobs can prevent complete acquisition. Blob classification uses NUL
bytes or failed strict UTF-8 decoding. No repository programs, filters, builds,
or workflows are executed; Git external diffs and text conversion are disabled.

The baseline provides deterministic **file-level evidence only**. Structural
analysis is visibly unavailable, not zero. GitHub discussion totals in new
reports include bots and do not claim verified human approvals; the curated
study below has separate, stronger review-selection evidence.

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

For repositories without a remote, pass an explicit baseline when opening the
canvas, for example `input: { "base": "main" }`. The project extension resolves
the checkout from its own location, not the session's artifact directory.

The canvas requires the Copilot App extension runtime and an authenticated
`gh` installation when a usable `origin/HEAD` ref is not available.

Run the analyzer, persistence, CLI, renderer, and corpus-replay tests:

```sh
node --test test/*.test.mjs research/metrics.test.mjs
```

## Study data

### Browse all 30 sample PRs

Generate a standalone, offline gallery using the **same dashboard as the review
canvas**, not the retired research preview:

```sh
node cli.mjs corpus --input research/corpus.json --out /tmp/sample-gallery
open /tmp/sample-gallery/review.html
```

No GitHub authentication, network access, or sampled repository checkout is
needed. The self-contained HTML includes all 30 PRs and their 61 original
commits. The output also includes immutable report JSON files that can be
reopened with `node cli.mjs view --input <report-id>.json --out <directory>`.

Use **Report** to switch PRs, or expand **Compare reports** to search by
repository or title and compare footprints. Select an original commit using
**Scope** or **Original commits**; expand a role to inspect its file list.
For a quick tour, try these repositories:

| Repository | What to look at |
|---|---|
| `spf13/cobra` | A one-file, one-line source change |
| `nodejs/node` | A small test-only change |
| `babel/babel` | A tiny source change alongside inputs and snapshots |
| `microsoft/TypeScript` | 812 final changed files, snapshot-heavy work, and ten commits |
| `angular/angular` | A deletion-heavy source change |
| `elastic/elasticsearch` | 14 final changed lines versus 25,093 lines in an upstream merge context |

These are retained collection-time snapshots, not fresh GitHub acquisitions.
Patch completeness and lexical evidence come from the original collection;
source and patches are not embedded or reverified on import. Human approval
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
