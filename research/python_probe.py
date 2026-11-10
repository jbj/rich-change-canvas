import ast
import base64
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent


class RemoveDocstrings(ast.NodeTransformer):
    def visit_Module(self, node):
        self.generic_visit(node)
        if node.body and isinstance(node.body[0], ast.Expr):
            value = node.body[0].value
            if isinstance(value, ast.Constant) and isinstance(value.value, str):
                node.body.pop(0)
        return node

    visit_ClassDef = visit_Module
    visit_FunctionDef = visit_Module
    visit_AsyncFunctionDef = visit_Module


def load(repo, path, sha):
    endpoint = f"repos/{repo}/contents/{path}?ref={sha}"
    result = json.loads(subprocess.check_output(["gh", "api", endpoint]))
    if result["encoding"] != "base64":
        raise ValueError(f"Full file content unavailable: {endpoint}")
    return base64.b64decode(result["content"]).decode("utf-8")


def functions(tree):
    result = {}

    def collect(node, prefix=""):
        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                name = f"{prefix}{child.name}"
                result.setdefault(name, []).append(child)
                collect(child, f"{name}.")
            elif isinstance(child, ast.ClassDef):
                collect(child, f"{prefix}{child.name}.")
            else:
                collect(child, prefix)

    collect(tree)
    return result


def complexity(function):
    count = 1

    def visit(node):
        nonlocal count
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
            return
        if isinstance(node, (ast.If, ast.For, ast.AsyncFor, ast.While, ast.IfExp, ast.ExceptHandler)):
            count += 1
        if isinstance(node, ast.BoolOp):
            count += len(node.values) - 1
        if isinstance(node, ast.comprehension):
            count += 1 + len(node.ifs)
        if isinstance(node, ast.match_case):
            if not (isinstance(node.pattern, ast.MatchAs) and node.pattern.pattern is None):
                count += 1
            if node.guard is not None:
                count += 1
        for child in ast.iter_child_nodes(node):
            visit(child)

    for statement in function.body:
        visit(statement)
    return count


def probe(sample):
    candidates = [
        file for file in sample["files"]
        if file["path"].endswith(".py") and file["status"] == "modified"
        and not any(part in file["path"].split("/") for part in ("test", "tests", "testing", "fixtures"))
        and not Path(file["path"]).name.startswith("test_")
    ]
    if not candidates:
        return {"pr": sample["url"], "status": "no-modified-production-python-file"}
    file = max(candidates, key=lambda item: item["additions"] + item["deletions"])
    before = ast.parse(load(sample["repository"], file["path"], sample["mergeBaseSha"]))
    after = ast.parse(load(sample["repository"], file["path"], sample["headSha"]))
    old, new = functions(before), functions(after)
    changed = []
    for name in sorted(old.keys() | new.keys()):
        lefts, rights = old.get(name, []), new.get(name, [])
        same_count = len(lefts) == len(rights)
        pairs = list(zip(lefts, rights)) if same_count else (
            [(left, None) for left in lefts] + [(None, right) for right in rights]
        )
        for occurrence, (left, right) in enumerate(pairs, 1):
            if left is not None and right is not None and ast.dump(left) == ast.dump(right):
                continue
            changed.append({
                "name": name,
                "occurrence": occurrence,
                "matching": "qualified-name-and-occurrence" if same_count else "unmatched-definition-count-changed",
                "before": complexity(left) if left is not None else None,
                "after": complexity(right) if right is not None else None,
                "beforeLine": left.lineno if left is not None else None,
                "afterLine": right.lineno if right is not None else None,
            })
    stripped_before = RemoveDocstrings().visit(before)
    stripped_after = RemoveDocstrings().visit(after)
    return {
        "pr": sample["url"], "path": file["path"], "status": "parsed",
        "scope": "largest modified production .py file only, not the whole PR",
        "changedFunctions": changed,
        "astEqualIgnoringDocstrings": ast.dump(stripped_before) == ast.dump(stripped_after),
        "note": "Ignoring docstrings does not prove behavioral equivalence: __doc__ is observable.",
    }


def self_test():
    tree = ast.parse(
        "def outer(a):\n"
        "    def inner(b):\n"
        "        if b:\n"
        "            return 1\n"
        "    if a and a > 1:\n"
        "        return inner(a)\n"
    )
    found = functions(tree)
    assert complexity(found["outer"][0]) == 3
    assert complexity(found["outer.inner"][0]) == 2
    assert len(functions(ast.parse("def f(): pass\ndef f(): pass"))["f"]) == 2
    assert ast.dump(RemoveDocstrings().visit(ast.parse('def f():\n    "doc"\n    return 1'))) == ast.dump(
        ast.parse("def f():\n    return 1")
    )


if __name__ == "__main__":
    self_test()
    corpus = json.loads((ROOT / "corpus.json").read_text())
    results = [probe(sample) for sample in corpus["samples"] if sample["language"] == "Python"]
    output = {
        "analyzer": "Python stdlib ast; research probe, not a production multi-language analyzer",
        "complexityVariant": "1 + if/for/async-for/while/conditional-expr/except + extra boolean operands + comprehensions/filters + nonwildcard match cases/guards; nested function bodies excluded",
        "results": results,
    }
    (ROOT / "python-probe.json").write_text(json.dumps(output, indent=2) + "\n")
    print(json.dumps(output, indent=2))
