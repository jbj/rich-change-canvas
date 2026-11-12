import { Parser, Language } from "web-tree-sitter";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { binary } from "../process.mjs";
import { dialectForPath, nodeKind, annotateDecisions } from "./rules.mjs";
import { snapshotDigest, validateSyntaxSnapshots } from "./snapshot.mjs";
import { packSnapshot } from "./encoding.mjs";

const require = createRequire(import.meta.url);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const runtimePath = require.resolve("web-tree-sitter/web-tree-sitter.wasm");
const runtime = { version: JSON.parse(readFileSync(join(dirname(runtimePath), "package.json"))).version, wasm: hash(readFileSync(runtimePath)),
  binding: hash(readFileSync(fileURLToPath(import.meta.resolve("web-tree-sitter")))) };
const grammars = new Map();
await Parser.init({ locateFile: () => runtimePath });
for (const dialect of ["javascript", "typescript", "tsx", "python", "go", "rust", "java"]) {
  const pkg = dialect === "tsx" ? "typescript" : dialect;
  const asset = join(dirname(require.resolve(`tree-sitter-${pkg}`)), "..", "..", `tree-sitter-${dialect}.wasm`);
  const bytes = readFileSync(asset);
  const language = await Language.load(bytes);
  grammars.set(dialect, { language, hash: hash(bytes), abi: language.abiVersion });
}

function offsets(text) {
  const bytes = new Uint32Array(text.length + 1);
  let byte = 0;
  for (let index = 0; index < text.length;) {
    const point = text.codePointAt(index);
    const width = point > 0xffff ? 2 : 1;
    bytes[index] = byte;
    if (width === 2) bytes[index + 1] = byte;
    byte += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    index += width;
    bytes[index] = byte;
  }
  return bytes;
}

function serialize(tree, text, dialect, maxNodes) {
  const bytes = offsets(text);
  const nodes = [], diagnostics = [], parents = [];
  const cursor = tree.walk();
  try {
    do {
      if (nodes.length === maxNodes) return null;
      const native = cursor.currentNode;
      const range = {
        startByte: bytes[native.startIndex], endByte: bytes[native.endIndex],
        startIndex: native.startIndex, endIndex: native.endIndex,
        startPosition: native.startPosition, endPosition: native.endPosition,
      };
      const parent = parents.at(-1) ?? null;
      const hasBody = native.childForFieldName("body") !== null;
      const kind = nodeKind(dialect, native.type, hasBody);
      const node = { id: nodes.length, type: native.type, named: native.isNamed,
        parent, field: cursor.currentFieldName, children: [], range,
        ...(kind ? { kind } : {}),
        ...(/identifier$/.test(native.type) ?
          { value: text.slice(native.startIndex, native.endIndex) } : {}) };
      nodes.push(node);
      if (parent !== null) nodes[parent].children.push(node.id);
      if (native.isError || native.isMissing) {
        diagnostics.push({ kind: native.isMissing ? "missing" : "error", type: native.type, node: node.id, range });
      }
      if (cursor.gotoFirstChild()) {
        parents.push(node.id);
        continue;
      }
      while (!cursor.gotoNextSibling()) {
        if (!cursor.gotoParent()) return { nodes, diagnostics };
        parents.pop();
      }
    } while (true);
  } finally {
    cursor.delete();
  }
}

export function createSyntaxAnalyzer({
  directory = join(homedir(), ".cache", "rich-change-canvas", "syntax-v1"),
  maxNodes = 500_000, maxBytes = 16 * 1024 * 1024, maxParseMilliseconds = 10_000,
  onParse = () => {},
} = {}) {
  for (const value of [maxNodes, maxBytes, maxParseMilliseconds]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError("Invalid syntax resource budget");
  }
  const memory = new Map();
  return function analyze(bytes, path) {
    const dialect = dialectForPath(path);
    if (!dialect) return { status: "unsupported", reason: "No grammar for this file type." };
    if (bytes === null) return { status: "absent", dialect };
    if (binary(bytes)) return { status: "unsupported", reason: "Binary or non-UTF-8 content." };
    if (bytes.length > maxBytes) return { status: "resource-limit", reason: "Syntax byte budget exceeded." };
    const grammar = grammars.get(dialect);
    const identity = { schemaVersion: 1, adapterVersion: 2, dialect, sourceHash: hash(bytes),
      sourceBytes: bytes.length, runtime, grammar: { hash: grammar.hash, abi: grammar.abi } };
    const key = hash(JSON.stringify(identity));
    if (memory.has(key)) return memory.get(key);
    const pathOnDisk = directory === null ? null : join(directory, `${key}.json`);
    if (pathOnDisk) {
      let saved;
      try { saved = JSON.parse(readFileSync(pathOnDisk, "utf8")); }
      catch (error) {
        if (error.code !== "ENOENT") throw new Error(`Cannot read syntax cache: ${pathOnDisk}`, { cause: error });
      }
      if (saved) {
        if (JSON.stringify(saved.identity) !== JSON.stringify(identity) || snapshotDigest(saved) !== saved.id ||
            !["available", "parse-error"].includes(saved.status) || !Array.isArray(saved.nodes)) {
          throw new Error(`Syntax cache identity mismatch: ${pathOnDisk}`);
        }
        validateSyntaxSnapshots({ [saved.id]: saved });
        if (saved.nodes.length > maxNodes) return { status: "resource-limit", reason: "Syntax node budget exceeded." };
        memory.set(key, saved);
        return saved;
      }
    }
    const parser = new Parser();
    let tree;
    try {
      parser.setLanguage(grammar.language);
      onParse({ dialect, sourceHash: identity.sourceHash });
      const started = performance.now();
      tree = parser.parse(bytes.toString("utf8"), null, {
        progressCallback: () => performance.now() - started > maxParseMilliseconds,
      });
      if (!tree) return { status: "resource-limit", reason: "Syntax parse time budget exceeded." };
      const serialized = serialize(tree, bytes.toString("utf8"), dialect, maxNodes);
      if (!serialized) return { status: "resource-limit", reason: "Syntax node budget exceeded." };
      const content = { identity, dialect, status: tree.rootNode.hasError ? "parse-error" : "available", ...serialized };
      annotateDecisions(content);
      const packed = packSnapshot(content, bytes.toString("utf8"));
      const snapshot = { ...packed, id: hash(JSON.stringify(packed)) };
      if (pathOnDisk) {
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        const temporary = `${pathOnDisk}.${randomUUID()}.tmp`;
        try {
          writeFileSync(temporary, JSON.stringify(snapshot), { flag: "wx", mode: 0o600 });
          renameSync(temporary, pathOnDisk);
        } finally { rmSync(temporary, { force: true }); }
      }
      memory.set(key, snapshot);
      return snapshot;
    } finally {
      tree?.delete();
      parser.delete();
    }
  };
}
