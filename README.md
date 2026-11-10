# Rich change summaries

Research and prototypes for a read-only Copilot App canvas that helps reviewers
understand a change between a diffstat and the full diff.

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

**Review desk** compares reports, **Change receipt** exposes role rules and
per-file measurements, and **Commit trail** lets you zoom into every original
commit. Staged, unstaged, and untracked layers are independent snapshots,
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
same read-only review desk as a canvas in the GitHub Copilot App. It analyzes
the current session's repository, including committed changes and separate
staged, unstaged, and untracked layers. The review desk shows each non-empty
local layer as its own row with counts; select a row to inspect that layer's
file receipts. Local counts are not added to the committed footprint. The baseline is resolved from
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

## Explore the study

Requires Node.js 22 or newer. No packages, server, or repository code execution
are needed.

```sh
node --test research/metrics.test.mjs
node research/build.mjs
open research/preview.html
```

The prototype has three linked views: **Review desk**, **Change receipt**, and
**Commit trail**. It uses absolute added/deleted text-line counts, exposes file
classification rules, and distinguishes final PR changes from ordinary commits
and upstream merge context. It has no approval or merge controls.

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
node research/build.mjs
```

`python_probe.py` needs Python 3.13 or newer and only uses the standard library.
It parses source as data without importing or executing it. Offline generation
uses the checked-in `python-probe.json`, so Python and network access are not
required to explore the existing study.

The prototype is not yet a registered Copilot canvas extension. SDK scaffolding,
runtime discovery, and action routing must be verified before installation is
claimed.
