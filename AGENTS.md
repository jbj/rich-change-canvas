# Development and verification

This repository runs directly from Node.js source (Node.js 22+ and Git).
There is no build or dependency-install step for the analyzer or dashboard.

Run focused tests for the changed behavior, then the integrated suite:

```sh
node --test test/output.test.mjs
npm test
```

For Footprint table changes, follow the
[layout contract and testing guide](docs/footprint-table.md), including column
sizing priorities, synthetic edge cases, and corpus browser checks.

## Testing the live canvas

The extension imports modules once, and the renderer loads its HTML, CSS,
and JavaScript together. After changing `.github/extensions/`, `src/`, or
`web/`, use `extensions_reload`, then `extensions_manage` list/inspect to
confirm the provider loaded. Refreshing or reopening an iframe alone does
not reload imported code or assets.

Reopen the review canvas after reloading. Each canvas instance retains the
report collected when it first opens; use a fresh instance ID when testing
new repository changes. Reusing an instance focuses/reloads its page, not
necessarily its report. Provider restart rehydrates instances and recollects
their reports.

A successful open RPC or HTTP 200 does not prove browser rendering works.
Inspect the served page with browser tools, confirm `#error` is empty and
hidden, and exercise the changed controls. For scope changes, check All,
individual local layers, committed changes, and original commits where
present. If browser inspection is unavailable, state that limitation;
do not claim visual verification. Fresh-process tests complement this check
but do not establish that the live provider has reloaded.

Keep generated reports and temporary validation fixtures outside the analyzed
repository. Do not execute code from repositories being analyzed.
