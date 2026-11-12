# Syntax snapshots and cyclomatic complexity

Tree-sitter runs inside the trusted analyzer, using `web-tree-sitter` and
prebuilt WASM assets from the pinned official grammar packages. It never imports
or executes analyzed code, repository-provided grammars, queries, or plugins.
JavaScript includes JSX; TypeScript and TSX have separate grammar identities.
Python `.py`/`.pyi`, Go, Rust, and Java are supported. Other extensions,
embedded languages, Flow extensions rejected by the JavaScript grammar, and
macro expansions are not inferred.

## Tree contract

`report.syntaxSnapshots[id]` contains a versioned source snapshot. Each file's
`syntax.before` and `syntax.after` are `{ id, status }` references, or explicit
`absent`, `unsupported`, or `resource-limit` results. A missing side has no real
tree; a supported empty file does. Missing legacy evidence is not an empty tree.
Trees are deduplicated across whole changes, original commits, and local layers.
All-scope totals still aggregate independent comparisons, not unique ASTs.
Report JSON uses compact rather than indented encoding: indentation of millions
of numeric node rows can exceed Node's single-string limit. Dashboard HTML is a
metric projection without unused AST tables; use the immutable JSON report for
syntax queries. This also keeps a multi-report gallery below that limit.

Snapshots contain source SHA-256/byte size, dialect, grammar WASM SHA-256/ABI,
runtime binding/WASM identities, syntax schema/adapter versions, status,
diagnostics, and a flat preorder `nodes` table. To keep the real corpus portable,
the wire/cache encoding is `packed-v1`: each row is
`[typeId, parentId, fieldId, startIndex, endIndex, startByte, endByte, flags, valueId?]`.
Type, field, and identifier strings are interned in `types`, `fields`, and
`values`; null parent/field is -1. Flags are named=1, function=2, decision=4,
boolean=8. Row index is the node ID. `lineStarts` records UTF-16 line starts.
`unpackSnapshot` from `src/syntax/encoding.mjs` restores the public node view.
Selection/complexity helpers also accept packed trees directly. Unpack once when
performing repeated custom traversal; child lists and positions are derived,
not redundantly stored per token.

The snapshot ID hashes its entire JSON payload excluding `id`. Decoded nodes have snapshot-local IDs, raw grammar
types, named/token flags, parent/ordered children, field names, relevant
identifier values, and normalized `function`, `decision`, or `boolean` kinds.
Unnormalized nodes and anonymous concrete tokens are retained, not discarded.
IDs are not stable declaration identities across revisions.

Every node and diagnostic has a half-open range:

- `startByte`/`endByte`: offsets into original UTF-8 bytes.
- `startIndex`/`endIndex`: JavaScript UTF-16 string indices.
- `startPosition`/`endPosition`: zero-based row and UTF-16 column.

CR is a real column character; LF starts the next row. UTF-8 offsets are
explicitly converted from the WASM binding's UTF-16 indices. Source hashes
identify the exact bytes to which ranges apply; they do not prove authenticity.
Full source files, string literal values, and comment text are not embedded,
but identifiers, grammar token types, and existing diff lines expose source
information. Keep private-source reports, HTML, and caches private.

Use the pure helpers in `src/syntax/rules.mjs` without loading WASM:

```js
import { selectNodes, children, functionComplexities } from "./src/syntax/rules.mjs";
const tree = report.syntaxSnapshots[file.syntax.after.id];
const functions = selectNodes(tree, { kind: "function" });
const name = children(tree, functions[0], "name")[0]?.value;
const perFunction = functionComplexities(tree);
```

Selection accepts `type`, `kind`, and `field`. Parent/child links support more
complex visitors. These are queries over serializable syntax, not an arbitrary
Tree-sitter S-expression interpreter over JSON. No native Tree objects survive
serialization; an offline report needs neither source nor a live parser for
these queries. The future tree-diff UI/matching algorithm is intentionally absent.

## Complexity definition (version 1)

For each executable function/method/constructor/closure, start at 1 and add
syntactic decisions below. Nested functions count separately, not toward the
enclosing function. Declarations without bodies do not count. Anonymous
functions retain a null name. Top-level decisions and text in comments/strings
are excluded. Valid files with no executable functions measure 0.

| Dialect | Additional decisions |
|---|---|
| JavaScript, TypeScript, TSX | `if`, `for`/`for in`/`for of`, `while`, `do`, each non-default `case`, each `catch`, ternary; `&&`, `||`, `??` and their short-circuit assignment forms. Arrows, generators and methods count as functions. |
| Python | `if`/`elif`, `for`, `while`, each `except` handler, conditional expressions, each comprehension `for` and filter `if`, non-default match arms and guards, `and`/`or`. Lambdas count as functions. |
| Go | `if`, each `for` (including range), expression/type switch case clauses, select communication cases, `&&`/`||`. Function literals and methods count as functions. |
| Rust | `if` (including if-let), `for`, `while`, `loop`, non-default match arms, match guards, `&&`/`||`. Closures count as functions; macro token trees are not expanded. |
| Java | `if`, regular/enhanced `for`, `while`, `do`, `catch`, ternary, non-default switch labels, `&&`/`||`. Constructors, compact constructors and lambdas count as functions. |

Multiple alternatives sharing a case/arm count once. Unconditional Python/Rust
wildcard arms and Java/JS/Go defaults do not count. A guarded wildcard is not an
unconditional default; its conditional arm and guard are counted. `else`,
`finally`, ordinary calls/returns/breaks, optional chaining, bitwise operators,
and Rust `?` do not independently increase the count. Boolean chains count each
short-circuit operator, independent of parentheses.

The metric is a reproducible **McCabe-style syntactic convention**, not an exact
control-flow graph, a count of tests needed, a quality score, or a semantic
equivalence claim. Language grammar limitations and opaque macro content remain.
Per-file, role and scope results **sum** per-function complexity before/after,
with a signed delta, not added/removed changed-line counts. Each side retains
its per-function node IDs, names, ranges, and values.

Any `ERROR` or missing node makes that snapshot's complexity unavailable,
including invalid test fixtures and incomplete edits. The recovered tree and
diagnostics remain queryable. These sides remain eligible in coverage, so mixing
valid and invalid files gives partial evidence, not a fully measured low total.
Unsupported languages and binary/non-UTF-8 snapshots are excluded from eligibility.

## Lifecycle, limits, and caching

The runtime and seven grammar variants initialize once at module import with
top-level await. Acquisition APIs remain synchronous where they were synchronous.
Parsing is synchronous after initialization; text/regex analysis and saved-report
rendering do not import the parser. Only full snapshots go through syntax
acquisition, never synthetic changed-line fragments.

Default per-snapshot limits are 16 MiB source, 500,000 nodes, and a 10-second
parse budget checked by Tree-sitter's progress callback. The callback is
cooperative, not a hard process deadline. Node traversal is iterative. Limit
outcomes retain explicit unavailable reasons and are not cached as successful
trees. Unexpected failures and missing assets are errors, not lexical fallbacks.
Parser, tree, and traversal cursor resources are deleted after use.

`createSyntaxAnalyzer({ directory, maxBytes, maxNodes, maxParseMilliseconds,
onParse })` allows bounded callers and isolated tests; `directory: null` disables
disk persistence. `onParse` observes actual parse attempts, not cache hits.
Acquisition adapters accept `syntaxAnalyzer` for shared/instrumented reuse.

The default cache is `~/.cache/rich-change-canvas/syntax-v1`. Keys hash source
bytes, dialect, schema/adapter version, and runtime/grammar identities. Identical
content under different paths/revisions reuses parsing, but a renamed language
suffix selects its own grammar. Mutable working/index bytes are content-keyed,
not trusted by revision name. Process-local work is reused; synchronous parsing
cannot duplicate an in-flight parse within that process. Processes may compute
the same miss independently and atomically publish the same content.

Writes use temporary files and atomic rename, with 0700 directories/0600 files.
Cache identity and node structure are checked on read; corrupt entries fail
explicitly. Different grammar/schema identities use different keys. Deterministic
parse errors are cached; transient failures and limits are not. Metric rule
versions are separate so complexity can be recomputed from cached ASTs.
Delete the syntax cache explicitly to reclaim space or force reparsing. It has
no expiry/eviction policy. The existing GitHub response/source cache is separate.

### Retained-corpus footprint

A full acquisition of the 30 retained PRs and 61 commits produced 2,568 distinct
syntax snapshots and 13,298,663 concrete nodes. Compact JSON reports together
were 636 MiB; metric-only gallery HTML was 66 MiB. Full-snapshot source acquisition
was already cached. A cold syntax run parsed all 2,568 snapshots; fresh-process
warm replay performed zero parses and zero GitHub requests and reproduced the
same report identities. These are measurements of this corpus, not size or
performance guarantees.

The full multi-report run reached approximately 6.8 GiB peak RSS when parsing
and saving/rendering, and 3.9 GiB during warm acquisition/statistics. Large
multi-report galleries therefore need considerably more memory/storage than
the WASM installation alone. Normal single-change analysis does not acquire
the entire corpus. Parser errors were retained on 1,514 JavaScript, four Go,
and two Java snapshots; those trees do not yield measured complexity. This
conservative policy can substantially reduce coverage on fixture-heavy changes.

## Installation and extension distribution

Run `npm ci --ignore-scripts --omit=optional` before analysis. Locally configured
CFS users can use `gh cfs -- npm ci --ignore-scripts --omit=optional`. The lockfile
retains integrity hashes but omits registry-specific resolved URLs; the configured
registry supplies packages. CI uses the same script-disabled installation.

Official grammar packages also ship native bindings and install scripts, but
this analyzer loads only `.wasm` assets and does not run those scripts. WASM
avoids native compiler and Node-ABI dependencies. The installed dependency tree
measured about **85 MiB** on the development machine, including unused grammar
sources/prebuilds; a future asset-only distribution can be smaller. No compilation
or package acquisition occurs when opening a canvas. After setup, local analysis
and cached GitHub replay work offline.

Copilot supplies `@github/copilot-sdk`, **not** these npm packages or an implicit
installation step. Installing dependencies and reloading extensions is required.
Missing packages/assets fail provider initialization explicitly.

The project extension imports analyzer and web assets from outside its own
`.github/extensions/rich-change-review/` folder. A portable release must bundle
those modules/assets together with the runtime JS/WASM and selected grammar
WASM, preserve relative/resolved asset paths, and include upstream license
notices. The grammar/runtime packages are MIT licensed; transitive package
licenses also need to be retained if shipped. Shipping just the extension folder
does not work. Gist sharing skips node_modules/build outputs and rejects binary
files, so it cannot directly carry this WASM distribution. This change documents
the constraint; it does not add a release bundler, startup downloader, or a
platform-specific native build.
