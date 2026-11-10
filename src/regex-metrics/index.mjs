const javascript = {
  comment: /^\s*(?:\/\/|\/\*|\*(?!\/)|\*\/)/,
  decisions: /\b(?:if|for|while|case|catch)\b|&&|\|\||\?\?/g,
  declarations: /^\s*(?:(?:export|default|declare|async|abstract)\s+)*(?:function|class|interface|enum|type|namespace)\b/,
  imports: /^\s*(?:import\b|export\b.*\bfrom\b)|\brequire\s*\(/,
  tests: /\b(?:test|it|describe)(?:\.(?:only|skip|todo))?\s*\(/g,
};

export const languageRules = {
  JavaScript: javascript,
  TypeScript: javascript,
  Python: {
    comment: /^\s*#/,
    decisions: /\b(?:if|elif|for|while|except|and|or)\b/g,
    declarations: /^\s*(?:async\s+)?(?:def|class)\b/,
    imports: /^\s*(?:from\s+\S+\s+import\b|import\b)/,
    tests: /^\s*(?:async\s+)?def\s+test_\w+\s*\(/gm,
  },
  Go: {
    comment: javascript.comment,
    decisions: /\b(?:if|for|case|select)\b|&&|\|\|/g,
    declarations: /^\s*(?:func|type)\b/,
    imports: /^\s*import\b/,
    tests: /^\s*func\s+(?:Test|Benchmark|Fuzz)\w*\s*\(/gm,
  },
  Rust: {
    comment: javascript.comment,
    decisions: /\b(?:if|for|while|match)\b|&&|\|\|/g,
    declarations: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:(?:async|unsafe|const)\s+)*(?:fn|struct|enum|trait|impl|mod|type)\b/,
    imports: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:use|extern\s+crate)\b/,
    tests: /#\[(?:\w+::)*test(?:\]|\()/g,
  },
  Java: {
    comment: javascript.comment,
    decisions: /\b(?:if|for|while|case|catch)\b|&&|\|\|/g,
    declarations: /^\s*(?:(?:public|protected|private|static|final|abstract|sealed|non-sealed)\s+)*(?:class|interface|enum|record)\b|^\s*(?:(?:public|protected|private|static|final|abstract|synchronized|native)\s+)+[\w<>,?[\]. ]+\s+\w+\s*\(/,
    imports: /^\s*import\b/,
    tests: /@(?:Test|ParameterizedTest|RepeatedTest|TestFactory|TestTemplate)\b/g,
  },
};

const lexical = (id, label, unit, reducer, description, measure, options = {}) => ({
  id, version: 1, label, unit, reducer, tier: "Regex heuristic", mode: "diffstat", textOnly: true,
  description: `${description} Approximate: strings, comments and multiline syntax can cause false positives/negatives. Unsupported languages are excluded.`,
  supports: ({ language }) => Boolean(languageRules[language]),
  measure: (snapshot) => measure(snapshot, languageRules[snapshot.language]),
  ...options,
});
function matches(text, pattern) {
  let total = 0;
  for (const match of text.matchAll(pattern)) total++;
  return total;
}
const count = (numerator) => ({ numerator, denominator: 1 });

export const regexPlugins = [
  lexical("comment-lines", "Comment-looking lines", "lines", "sum",
    "Lines starting with # (Python) or //, /*, *, */ (other supported languages). Counts qualifying added/removed lines. Not parsed comments; Python docstrings are excluded.",
    ({ shape }, rules) => count(shape.lines.filter((line) => rules.comment.test(line)).length),
    { legacy: { id: "comment-share", version: 1 } }),
  lexical("decision-keywords", "Decision keywords", "occurrences", "sum",
    "if/for/while and language-specific case/catch/except/match/select, boolean operators, and JS/TS ?? occurrences. Not cyclomatic complexity; ternary punctuation is excluded.",
    ({ shape }, rules) => count(matches(shape.lines.join("\n"), rules.decisions))),
  lexical("declaration-lines", "Declaration-like lines", "lines", "sum",
    "Lines matching language-specific function/type declarations. JS/TS excludes arrow functions and methods; Java methods require a modifier. Not an exact symbol count.",
    ({ shape }, rules) => count(shape.lines.filter((line) => rules.declarations.test(line)).length)),
  lexical("import-lines", "Import-like lines", "lines", "sum",
    "Lines matching imports/use/require/from directives. Grouped/multiline imports may count only their opening line. Not semantic coupling.",
    ({ shape }, rules) => count(shape.lines.filter((line) => rules.imports.test(line)).length)),
  lexical("test-markers", "Test markers", "occurrences", "sum",
    "JS/TS test/it/describe calls, Python test_ definitions, Go Test/Benchmark/Fuzz functions, Rust test attributes, or Java test annotations. Not test execution or coverage.",
    ({ shape }, rules) => count(matches(shape.lines.join("\n"), rules.tests))),
];
