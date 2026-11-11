import { unpackSnapshot, nodeRange } from "./encoding.mjs";

export function dialectForPath(path) {
  if (/\.[cm]?jsx?$/.test(path)) return "javascript";
  if (/\.tsx$/.test(path)) return "tsx";
  if (/\.[cm]?ts$/.test(path)) return "typescript";
  return [["python", /\.pyi?$/], ["go", /\.go$/], ["rust", /\.rs$/], ["java", /\.java$/]]
    .find(([, pattern]) => pattern.test(path))?.[0] ?? null;
}

const js = {
  functions: ["function_declaration", "function_expression", "generator_function_declaration",
    "generator_function", "arrow_function", "method_definition"],
  decisions: ["if_statement", "for_statement", "for_in_statement", "while_statement",
    "do_statement", "switch_case", "catch_clause", "ternary_expression"],
  boolean: ["&&", "||", "??", "&&=", "||=", "??="],
};
const rules = {
  javascript: js, typescript: js, tsx: js,
  python: {
    functions: ["function_definition", "lambda"],
    decisions: ["if_statement", "elif_clause", "for_statement", "while_statement",
      "except_clause", "except_group_clause", "conditional_expression", "for_in_clause", "if_clause"],
    boolean: ["and", "or"],
  },
  go: {
    functions: ["function_declaration", "method_declaration", "func_literal"],
    decisions: ["if_statement", "for_statement", "expression_case", "type_case", "communication_case"],
    boolean: ["&&", "||"],
  },
  rust: {
    functions: ["function_item", "closure_expression"],
    decisions: ["if_expression", "for_expression", "while_expression", "loop_expression"],
    boolean: ["&&", "||"],
  },
  java: {
    functions: ["method_declaration", "constructor_declaration", "compact_constructor_declaration", "lambda_expression"],
    decisions: ["if_statement", "for_statement", "enhanced_for_statement", "while_statement",
      "do_statement", "catch_clause", "ternary_expression"],
    boolean: ["&&", "||"],
  },
};

export function children(snapshot, node, field) {
  snapshot = unpackSnapshot(snapshot);
  return node.children.map((id) => snapshot.nodes[id]).filter((child) => field === undefined || child.field === field);
}

export function selectNodes(snapshot, { type, kind, field } = {}) {
  snapshot = unpackSnapshot(snapshot);
  return (snapshot.nodes ?? []).filter((node) =>
    (type === undefined || node.type === type) && (kind === undefined || node.kind === kind) &&
    (field === undefined || node.field === field));
}

export function nodeKind(dialect, type, hasBody) {
  const rule = rules[dialect];
  if (rule.functions.includes(type) && hasBody) return "function";
  if (rule.decisions.includes(type)) return "decision";
  if (rule.boolean.includes(type)) return "boolean";
  return null;
}

function isWildcard(snapshot, node) {
  const parts = children(snapshot, node).filter((child) => child.type !== "comment");
  return parts.length === 1 && parts[0].type === "_";
}

function decision(snapshot, node) {
  if (node.kind === "decision" || node.kind === "boolean") return 1;
  if (snapshot.dialect === "java" && node.type === "switch_label") {
    return children(snapshot, node).some((child) => child.type === "case") ? 1 : 0;
  }
  if (snapshot.dialect === "rust" && node.type === "match_arm") {
    const pattern = children(snapshot, node, "pattern")[0];
    return pattern && !isWildcard(snapshot, pattern) ? 1 : 0;
  }
  if (snapshot.dialect === "rust" && node.field === "condition" &&
      snapshot.nodes[node.parent]?.type === "match_pattern") return 1;
  if (snapshot.dialect === "python" && node.type === "case_clause") {
    const pattern = children(snapshot, node).find((child) => child.type === "case_pattern");
    // A guarded wildcard is a conditional arm, not an unconditional default.
    return pattern && (!isWildcard(snapshot, pattern) || children(snapshot, node).some((child) => child.type === "if_clause")) ? 1 : 0;
  }
  return 0;
}

export function annotateDecisions(snapshot) {
  for (const node of snapshot.nodes) {
    if (!node.kind && decision(snapshot, node)) node.kind = "decision";
  }
}

export function functionComplexities(snapshot) {
  if (!snapshot?.nodes || snapshot.status !== "available") return [];
  const packed = snapshot.encoding === "packed-v1";
  const functions = [];
  const owners = new Int32Array(snapshot.nodes.length).fill(-1);
  for (const [id, node] of snapshot.nodes.entries()) {
    const parent = packed ? node[1] : node.parent ?? -1;
    const parentOwner = parent === -1 ? -1 : owners[parent];
    let owner = parentOwner;
    if (packed ? node[7] & 2 : node.kind === "function") {
      owner = functions.length;
      functions.push({ node: id, name: null, range: packed ? nodeRange(snapshot, node) : node.range, value: 1 });
    } else if (owner !== -1) {
      functions[owner].value += packed ? Number(Boolean(node[7] & 12)) : decision(snapshot, node);
    }
    const field = packed ? snapshot.fields[node[2]] : node.field;
    if (field === "name" && parentOwner !== -1 && functions[parentOwner].node === parent) {
      functions[parentOwner].name = (packed ? snapshot.values[node[8]] : node.value) ?? null;
    }
    owners[id] = owner;
  }
  return functions;
}

export const complexityPlugin = {
  id: "cyclomatic-complexity", version: 1, label: "Cyclomatic complexity", unit: "paths",
  tier: "Syntax", mode: "snapshot", textOnly: true, requiresSyntax: true, reducer: "sum",
  description: "Sum of per-function base 1 plus syntactic decisions and short-circuit boolean operators. Nested functions count separately. Parse errors are unavailable; not a quality or semantic-equivalence score.",
  supports: ({ language }) => ["JavaScript", "TypeScript", "Python", "Go", "Rust", "Java"].includes(language),
  measure: ({ syntax }) => {
    const functions = functionComplexities(syntax);
    return { numerator: functions.reduce((sum, fn) => sum + fn.value, 0), denominator: 1, functions };
  },
};
