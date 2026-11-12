# Footprint table layout and verification

The Footprint table uses shared, content-sized columns. Its purpose is to keep
file paths and their stats close together without wasting space that could
prevent a filename from being truncated or a number from wrapping.

## Layout contract

From left to right, the table has:

1. A left-aligned **Role / files** column.
2. Right-aligned **metric values**. The default **Summary** view always shows
   added/deleted text lines and adds a **Cyclomatic complexity** delta column
   when any file in the selected scope has a nonzero delta, even if file deltas
   cancel out in the role totals. Other selections have one numeric column.
3. Any **unused space**, after the last stats column.

Column boundaries are shared by the header, role rows, and visible file rows.
Natural widths come from the widest visible cell in each column, including
headers. Hidden file rows do not participate. Expanding or collapsing a role
can therefore move the stats columns.

The sizing priority is:

1. When everything fits, keep each column at its natural width. Leave all
   surplus space on the right, rather than stretching the filename column.
2. When space runs out, shrink only the filename column. Paths stay on one line
   and truncate in the middle with `...`, preserving the beginning and end.
3. Once the filename column reaches its minimum, let stats shrink by wrapping.
   The filename minimum aims to leave roughly ten visible characters plus the
   ellipsis, measured using the first and last five graphemes rather than a fixed
   pixel width. Short labels need not grow to that minimum.
4. Both numeric columns share further shrinkage in proportion to their
   available shrink capacity.

If even the combined minimums cannot fit, containment takes precedence: the
filename column can shrink below its normal minimum, then remaining stats
tracks can shrink further. This is a last-resort rule for extremely narrow
viewports, not the normal desktop or side-panel layout.

There must be no trailing surplus when columns have had to shrink. This is a
table-wide rule, not independent packing for each row: a short filename may
have space after it because another visible filename determines that shared
column's width.

### File rows and expanded diffs

- File summaries contain only the filename. Do not render a status label or
  reserve space for one, including for added, removed, renamed, or copied files.
  Status remains available in the accessible label.
- Keep the full path in the DOM, accessible label, and hover title. Middle
  truncation must not change its text or split combining characters or joined
  emoji.
- Expanded diffs span the full table width, including the surplus track. Their
  contents must not influence the filename or stats column widths.
- Text patches already include filenames; do not add another filename heading.
  Files without a displayable text patch retain full current/previous paths in
  their expanded details.
- Preserve patch whitespace and horizontal scrolling by default. **Wrap lines**
  changes presentation only and stays synchronized across open and newly opened
  diffs.
- Omit the binary-file total when it is zero.

## Implementation map

| File | Responsibility |
|---|---|
| [`src/table-layout.mjs`](../src/table-layout.mjs) | Pure `fitTableColumns(available, preferred, minimum)` allocation and measurement validation. |
| [`web/review.js`](../web/review.js) | Visible-row measurement, layout scheduling, grapheme-safe path splitting, and truncation state. |
| [`web/review.css`](../web/review.css) | Shared grid tracks, intrinsic measurement probes, middle ellipsis, right alignment, and full-width diff rows. |
| [`web/review.html`](../web/review.html) | Table structure and explicit accessibility roles. |
| [`src/render.mjs`](../src/render.mjs) | Packages the allocator and browser assets into the self-contained report. Assets are cached at module import. |
| [`research/browser-review.mjs`](../research/browser-review.mjs) | Browser harness, `auditReview`, and `inspectTableLayout` assertions against actual rendered geometry. |

Each row has four CSS grid tracks: filename, metric values, optional complexity,
and trailing surplus. The surplus track is decorative, not a semantic data column.
Diff cells span all tracks.

The renderer batches measurement writes and reads. It clones only visible cells
into hidden, inert, max-content probes, measures natural widths, substitutes
minimum-width samples, and measures again. Probes are removed in `finally`.
Measurements are rounded up to avoid accidental wrapping from fractional glyph
widths. A table `ResizeObserver` schedules recalculation through
`requestAnimationFrame`; rendering and role toggling also schedule it.

Do not restore independent per-row sizing or use a growing filename track to
push stats to the right edge. Both break the shared, compact-column contract.

## Automated tests

Run from the repository root with Node.js 22+ and Git. No build is needed.
Restore pinned dependencies first if they are missing
(`npm ci --ignore-scripts --omit=optional`, prefixed with `gh cfs --` in a
configured CFS environment).

```sh
node --test test/table-layout.test.mjs test/output.test.mjs test/browser-review.test.mjs
npm test
```

- [`test/table-layout.test.mjs`](../test/table-layout.test.mjs) covers natural
  widths, exact fits, filename-first shrinking, stats wrapping, fixed tracks,
  extreme counts and paths, growing back to natural widths, fractional and
  impossible widths, and invalid measurements.
- [`test/output.test.mjs`](../test/output.test.mjs) covers renderer behavior,
  including filename-only summaries for all statuses, unchanged path and patch
  text, Unicode splitting, resize updates, probe cleanup, and stale rows.
- [`test/browser-review.test.mjs`](../test/browser-review.test.mjs) checks the
  loopback helper's serving boundaries, not CSS geometry.

The allocator and fake-DOM tests do not establish that real browser rendering
works. Follow them with browser inspection when changing layout behavior.

## Browser checks

Keep generated HTML, JSON results, screenshots, and temporary fixtures outside
the analyzed repository. Never execute code from sampled repositories.

### Synthetic edge cases

Generate a self-contained report from the existing fixture factory:

```sh
export FOOTPRINT_REVIEW_DIR="$(mktemp -d "${TMPDIR:-/tmp}/footprint-review.XXXXXX")"
node --input-type=module <<'JS'
import { writeFile } from "node:fs/promises";
import { renderReports } from "./src/render.mjs";
import { tableLayoutFixtures } from "./test/table-layout-fixtures.mjs";

await writeFile(
  `${process.env.FOOTPRINT_REVIEW_DIR}/edges.html`,
  renderReports(tableLayoutFixtures()),
);
console.log(process.env.FOOTPRINT_REVIEW_DIR);
JS
node research/browser-review.mjs "$FOOTPRINT_REVIEW_DIR/edges.html"
```

Open the printed loopback URL. The eight fixtures cover short paths, long
filenames, huge counts and binary sizes, the widest path and stats occurring in
different rows, renames and Unicode, an empty scope, a long embedded diff, and
Summary complexity deltas that cancel in the role totals.

The **Audit all reports** button uses widths 480, 640, 800, 1024, and 1280 CSS
pixels. To include a narrower stress case, run this in the harness page's browser
console, not the report iframe's console:

```js
const result = await audit(
  document.getElementById("preview"),
  [320, 480, 640, 1024, 1280],
);
console.log(JSON.stringify(result, null, 2));
```

Expect an empty `failures` array. The audit waits for layout to settle, including
scrollbar-driven resizing, and checks column alignment, natural sizing, shrink
priority, minimums, trailing surplus, right alignment, overflow, middle ellipsis,
full-path access, collapse restoration, and diff wrapping without text changes.

Keep the page active during the audit. Hidden browser surfaces can suspend
animation frames; a stalled audit is not a pass. Save the result JSON outside
the repository and stop the helper with Ctrl-C when finished.

### Corpus and visual inspection

Also check the 30-PR corpus, which exercises realistic file lists and metrics:

```sh
node cli.mjs corpus --input research/corpus.json --out "$FOOTPRINT_REVIEW_DIR/corpus"
node research/browser-review.mjs "$FOOTPRINT_REVIEW_DIR/corpus/review.html"
```

The first acquisition requires authenticated `gh` and network access;
subsequent runs reuse the persistent cache. See the
[corpus instructions](../README.md#browse-all-30-sample-prs) for details.

Run **Audit all reports** and inspect representative screenshots at wide and
narrow widths. Confirm:

- Short paths and small counts stay together on the left, with surplus after
  the stats.
- Long paths middle-truncate before stats wrap; huge counts wrap only once the
  filename reaches its minimum.
- Different rows still share column boundaries, even when the widest filename
  and widest stats occur in different rows.
- Expanding/collapsing roles and resizing both ways recompute natural widths.
- Added and renamed files have no status text or reserved status area beside
  their names. Full paths remain accessible.
- Summary shows its complexity column only for nonzero file deltas in the
  selected scope. Both numeric columns remain right-aligned and can wrap at
  narrow widths. Snapshot metrics show signed deltas, blank zeros, and no charts.
  Opening a long diff does not widen columns; both diff wrapping modes work
  without page overflow.

Automated geometry checks complement visual and keyboard inspection; they do
not replace it.

## Live canvas verification

Follow [AGENTS.md](../AGENTS.md#testing-the-live-canvas): after changing renderer
assets or imported modules, reload extensions, confirm the provider is running
with list/inspect, and open a fresh review instance. Reopening an existing
instance or refreshing its iframe is not sufficient to load new source and
collect a new report.

Inspect the served page with browser tools. Confirm `#error` is empty and hidden,
expand roles and files, resize the viewport, and exercise the changed controls.
Check All, committed changes, individual local layers, and original commits
where present. A successful open RPC or HTTP 200 is not rendering evidence.
If browser inspection is unavailable, state that limitation instead of claiming
visual verification.
