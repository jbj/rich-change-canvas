# Low-discussion merged PR study

First qualifying recently updated merged non-bot PR per project; <=2 human issue + inline + nonempty review-body entries, bots reported separately; at least one current human head approval and one current maintainer approval; includes target-language file.

This is a convenience sample, not a random sample or a validated approval
classifier. Every sample has recorded non-author human approval on its head
commit and a current maintainer approval. Human means GitHub account type is
not Bot; unmarked automation can remain in that count. Review quality, off-platform
discussion, and correctness are not established by these observations.

## Corpus

30 projects, 6 languages,
1011 net-PR changed files, 61 commits.
14 PRs have more than one commit.
23 human discussion entries and
31 automated entries are recorded separately.

Language labels identify sampling cohorts, not every file's language. Changed
production source actually includes: Go, Java, JavaScript, Python, Rust, TypeScript.
The analyzer selects language by file, not by project name; for example, the
TypeScript-project sample also changes Go code.

| PR | Language cohort | Human entries | Head approvals | Commits | Source lines | Test/support lines | Fixture lines | Snapshot lines | Other total lines |
|---|---|---:|---:|---:|---|---|---|---|---:|
| [prettier/prettier#20459](https://github.com/prettier/prettier/pull/20459) | JavaScript | 1 | 1 | 3 | +5 / -0 | 0 | +8 / -0 | +30 / -3 | 18 |
| [eslint/eslint#21505](https://github.com/eslint/eslint/pull/21505) | JavaScript | 2 | 1 | 3 | +30 / -5 | 0 | 0 | 0 | 5 |
| [babel/babel#18533](https://github.com/babel/babel/pull/18533) | JavaScript | 1 | 1 | 1 | +1 / -1 | 0 | +37 / -0 | +292 / -0 | 0 |
| [nodejs/node#67260](https://github.com/nodejs/node/pull/67260) | JavaScript | 2 | 2 | 1 | 0 | +7 / -1 | 0 | 0 | 0 |
| [webpack/webpack#23155](https://github.com/webpack/webpack/pull/23155) | JavaScript | 0 | 1 | 1 | +235 / -154 | +384 / -0 | 0 | +20 / -20 | 5 |
| [microsoft/vscode#347276](https://github.com/microsoft/vscode/pull/347276) | TypeScript | 0 | 2 | 1 | +16 / -4 | +26 / -0 | 0 | 0 | 0 |
| [microsoft/TypeScript#65373](https://github.com/microsoft/TypeScript/pull/65373) | TypeScript | 0 | 1 | 10 | +151 / -189 | +31 / -31 | +2 / -2 | +2901 / -3053 | 141 |
| [typescript-eslint/typescript-eslint#13117](https://github.com/typescript-eslint/typescript-eslint/pull/13117) | TypeScript | 0 | 1 | 3 | +8 / -1 | +4 / -0 | 0 | 0 | 0 |
| [angular/angular#71801](https://github.com/angular/angular/pull/71801) | TypeScript | 1 | 1 | 1 | +5 / -196 | 0 | 0 | 0 | 0 |
| [vitejs/vite#24012](https://github.com/vitejs/vite/pull/24012) | TypeScript | 0 | 1 | 5 | +25 / -3 | +46 / -0 | 0 | 0 | 0 |
| [django/django#22257](https://github.com/django/django/pull/22257) | Python | 1 | 1 | 1 | +2 / -3 | 0 | 0 | 0 | 4 |
| [pallets/flask#5818](https://github.com/pallets/flask/pull/5818) | Python | 1 | 1 | 1 | +156 / -67 | +6 / -5 | 0 | 0 | 5 |
| [psf/requests#6966](https://github.com/psf/requests/pull/6966) | Python | 0 | 1 | 2 | +2 / -2 | 0 | 0 | 0 | 22 |
| [pandas-dev/pandas#71957](https://github.com/pandas-dev/pandas/pull/71957) | Python | 1 | 1 | 4 | +8 / -10 | 0 | 0 | 0 | 1 |
| [pytest-dev/pytest#15361](https://github.com/pytest-dev/pytest/pull/15361) | Python | 0 | 1 | 2 | +1 / -2 | +10 / -0 | 0 | 0 | 1 |
| [cli/cli#14918](https://github.com/cli/cli/pull/14918) | Go | 0 | 1 | 3 | +8 / -5 | 0 | 0 | 0 | 0 |
| [prometheus/prometheus#20400](https://github.com/prometheus/prometheus/pull/20400) | Go | 1 | 3 | 1 | +6 / -10 | +88 / -14 | 0 | 0 | 0 |
| [gin-gonic/gin#4852](https://github.com/gin-gonic/gin/pull/4852) | Go | 0 | 1 | 2 | +7 / -8 | +24 / -0 | 0 | 0 | 0 |
| [go-gorm/gorm#7582](https://github.com/go-gorm/gorm/pull/7582) | Go | 0 | 1 | 1 | +5 / -5 | +2 / -2 | 0 | 0 | 0 |
| [spf13/cobra#2390](https://github.com/spf13/cobra/pull/2390) | Go | 0 | 1 | 1 | +1 / -0 | 0 | 0 | 0 | 0 |
| [rust-lang/rust#165695](https://github.com/rust-lang/rust/pull/165695) | Rust | 2 | 1 | 1 | 0 | +25 / -0 | 0 | 0 | 0 |
| [tokio-rs/tokio#8750](https://github.com/tokio-rs/tokio/pull/8750) | Rust | 1 | 1 | 2 | +62 / -27 | 0 | 0 | 0 | 0 |
| [clap-rs/clap#6242](https://github.com/clap-rs/clap/pull/6242) | Rust | 0 | 1 | 1 | +1 / -1 | 0 | 0 | 0 | 0 |
| [serde-rs/serde#3038](https://github.com/serde-rs/serde/pull/3038) | Rust | 1 | 1 | 2 | +93 / -92 | 0 | 0 | 0 | 0 |
| [rust-lang/cargo#17706](https://github.com/rust-lang/cargo/pull/17706) | Rust | 2 | 1 | 1 | +2 / -2 | 0 | 0 | 0 | 0 |
| [apache/kafka#24140](https://github.com/apache/kafka/pull/24140) | Java | 2 | 1 | 2 | 0 | +6 / -5 | 0 | 0 | 0 |
| [apache/lucene#16919](https://github.com/apache/lucene/pull/16919) | Java | 0 | 2 | 1 | +11 / -7 | +28 / -0 | 0 | 0 | 0 |
| [junit-team/junit-framework#6200](https://github.com/junit-team/junit-framework/pull/6200) | Java | 0 | 1 | 1 | +45 / -40 | +62 / -6 | 0 | 0 | 6 |
| [elastic/elasticsearch#165122](https://github.com/elastic/elasticsearch/pull/165122) | Java | 2 | 1 | 2 | 0 | 0 | 0 | +9 / -5 | 0 |
| [mockito/mockito#3890](https://github.com/mockito/mockito/pull/3890) | Java | 2 | 1 | 1 | 0 | +0 / -2 | 0 | 0 | 0 |

## What this tests, and what it does not

- File-role summaries apply across all six languages without pretending to parse
  their semantic structure. Role reasons remain inspectable.
- 11 PRs contain recognized source
  changes without separate test/fixture/snapshot line changes. That is not proof
  of absent tests: Rust and other languages often keep tests inside source files.
  Using this as a mandatory manual-review rule would flag accepted examples.
- 10 PRs have different net-PR churn and summed
  individual-commit churn. Commit-level inspection must not substitute summed
  history for the final base/head diff.
- There are 5 merge commits in the sampled PR histories.
  Elasticsearch #165122 has only 14 final changed lines, but its upstream merge
  contributes 25,093 first-parent changed lines. Distinguish merge context from
  ordinary commits, without hiding conflict resolutions inside merges.
- Tokio #8750 adds an inline Rust test inside the same source file. The
  file-level "no separate test delta" observation is literally true but cannot
  support an absence-of-tests claim. The prototype exposes added Rust
  test-attribute patch lines as lexical evidence, not tests run or coverage.
- Kafka #24140 changes Java test-support code in src/testFixtures. The first
  classifier counted it as production source. The refined rule and regression
  test put it in test support. Babel output.json and TypeScript reference
  baselines are separated from test inputs as snapshots.
- 0 binary files occur in net PR diffs;
  0 occur in individual commit diffs. Display
  before/after bytes for these files, not zero lines as a size claim.
  If this count is zero, binary behavior has only unit-fixture validation in
  this study, not real-corpus validation. Attempts to enrich the study with a
  binary case did not meet the same review criteria; those cases were not
  smuggled into the accepted corpus.
- 0 incomplete textual patches occur in net
  PR diffs; 1 in commit diffs. Counts from
  GitHub metadata remain available even when patch-derived analysis is not.
- 0 files have no explicit role match. They remain
  visible as other, not silently counted as source.
- Only positive low-discussion examples were requested. This corpus can expose
  false alarms from proposed cues, but cannot measure contentious-PR recall,
  approval safety, false-negative rates, or human time saved.

## Structural probe, not just file statistics

The standard-library Python AST parser was applied to the largest modified
production Python file in each Python PR, not the complete PR or its individual
commits. A documented per-function decision-count variant excludes nested
function bodies from their parents. No changed code was executed.

- Django #22257 changes a docstring inside a source file. Executable AST
  structure is identical after removing leading docstring expressions;
  parse_time remains 6 -> 6. This is not a behavior-equivalence guarantee:
  Python docstrings remain observable through __doc__.
- Pandas #71957 is a performance change but its changed function remains
  4 -> 4. Decision counts do not measure runtime efficiency.
- Pytest #15361 is a bug fix but its changed function also remains 4 -> 4.
  Decision counts do not establish correctness.
- Flask #5818 changes dispatch/context structure. The probe sees added helper
  functions and an existing function changing 6 -> 5. Show a declaration
  inventory plus local deltas, not an unexplained summed quality score.
- Pandas contains repeated function names used for overload declarations. The
  first identity strategy failed on these. The probe preserves occurrences and
  refuses pairwise matching when definition counts differ.

Pinned multilingual Tree-sitter parser acquisition was attempted twice through
CFS, but Azure CLI token acquisition failed. No packages were installed and no
six-language semantic-analysis result is claimed. The Python probe uses only
the installed standard library. Other languages retain honest file-level
measurements until parser acquisition is available.

## Definitions and limitations

Line counts are added/deleted text lines, including comments and blanks, not
logical statements. Role heuristics are versioned in metrics.mjs. A file belongs
to one display category in this study; nested/inline test code is not separated.
Net PR diffs compare merge-base with head; each commit compares with its first
parent. A merge commit is explicitly marked and may include upstream changes.
GitHub lists at most 250 PR commits; such oversized histories are excluded with
a recorded selection reason. No repository code, build, or workflow is executed.
Raw responses stay in the session cache, not the shareable compact dataset.

## Reproduce

Run `STUDY_CACHE=/absolute/path/outside/repo node collect.mjs` to acquire public
data with authenticated gh. Run `node --test metrics.test.mjs`, then
`python3 python_probe.py` (Python 3.13 or newer) to refresh the Python probe.
The separate preview UI and builder have been retired; the corpus, summary,
probe output, and this written report remain as study artifacts.
`browser-validation.json` records historical checks of that retired preview.
The current review UI is the dashboard described in the repository README.
The retained summary and written report are not regenerated automatically.
