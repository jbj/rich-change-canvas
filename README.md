# Rich change summaries

Research and prototypes for a read-only Copilot App canvas that helps reviewers
understand a change between a diffstat and the full diff.

The current study covers **30 merged PRs from 30 projects in six languages**,
with **1,011 changed files and 61 individually inspectable commits**. Each sample
has at most two human discussion entries, a non-author human approval on its head
before merge, and a maintainer approval. Bot activity is reported separately.
This is a convenience sample, not a validated approval classifier.

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
