"""pyproject.toml declares every third-party package the code imports.

A fresh clone used to need five hand-installed packages. These tests walk the
imports of every module and map each top-level name to the distribution that
provides it (importlib.metadata), so an undeclared dependency fails here
rather than on someone else's machine.
"""
import ast
import re
import sys
import tomllib
from importlib.metadata import PackageNotFoundError, packages_distributions
from importlib.metadata import requires as metadata_requires
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PYPROJECT = tomllib.loads((ROOT / "pyproject.toml").read_text())

LOCAL = {"app", "ris", "evals", "graph", "scripts", "corpus", "tests", "conftest"}
SKIP_DIRS = {"web", "node_modules", ".venv", "venv", ".demo", "build", "dist", "__pycache__", ".git"}
PACKAGES = ["app", "ris", "evals", "graph", "scripts", "corpus"]


def _norm(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def _dist_name(requirement: str) -> str:
    return _norm(re.match(r"[A-Za-z0-9][A-Za-z0-9._-]*", requirement).group(0))


def _extras_deps(requirement: str) -> set[str]:
    """Distributions a declared extra pulls in, e.g. psycopg[pool] -> psycopg-pool."""
    m = re.match(r"\s*([A-Za-z0-9._-]+)\s*\[([^\]]+)\]", requirement)
    if not m:
        return set()
    try:
        reqs = metadata_requires(m.group(1)) or []
    except PackageNotFoundError:
        return set()
    out = set()
    for extra in (e.strip() for e in m.group(2).split(",")):
        for r in reqs:
            if re.search(rf"extra\s*==\s*['\"]{re.escape(extra)}['\"]", r):
                out.add(_dist_name(r))
    return out


def declared(include_dev: bool) -> set[str]:
    reqs = list(PYPROJECT["project"]["dependencies"])
    if include_dev:
        reqs += PYPROJECT["project"]["optional-dependencies"]["dev"]
    names = {_dist_name(r) for r in reqs}
    for r in reqs:
        names |= _extras_deps(r)
    return names


def imports(paths) -> dict[str, list[str]]:
    found: dict[str, list[str]] = {}
    for path in paths:
        tree = ast.parse(path.read_text(), str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                names = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                names = [node.module]
            else:
                continue
            for name in names:
                top = name.split(".")[0]
                if top in LOCAL or top in sys.stdlib_module_names or top == "__future__":
                    continue
                found.setdefault(top, []).append(f"{path.relative_to(ROOT)}:{node.lineno}")
    return found


def _py(dirs):
    for d in dirs:
        for path in sorted((ROOT / d).rglob("*.py")):
            if not any(part in SKIP_DIRS for part in path.relative_to(ROOT).parts[:-1]):
                yield path


def _undeclared(found, allowed):
    dist_of = packages_distributions()
    bad = {}
    for top, where in sorted(found.items()):
        dists = {_norm(d) for d in dist_of.get(top, [])}
        if not dists & allowed:
            bad[top] = (sorted(dists) or ["not installed"], where[:3])
    return bad


def test_runtime_imports_are_declared():
    bad = _undeclared(imports(_py(PACKAGES)), declared(include_dev=False))
    assert not bad, "runtime code imports packages pyproject.toml does not declare: " + "; ".join(
        f"{top} (from {', '.join(d)}; e.g. {', '.join(w)})" for top, (d, w) in bad.items())


def test_test_imports_are_declared():
    bad = _undeclared(imports(_py(["tests"])), declared(include_dev=True))
    assert not bad, "tests import packages that neither the runtime deps nor [dev] declare: " + "; ".join(
        f"{top} (from {', '.join(d)}; e.g. {', '.join(w)})" for top, (d, w) in bad.items())


def test_extras_count_as_declared():
    assert {"psycopg-binary", "psycopg-pool"} <= declared(include_dev=False)


def test_pins_and_removals():
    deps = PYPROJECT["project"]["dependencies"]
    names = {_dist_name(d): d for d in deps}
    assert "boto3" not in names and "botocore" not in names, "Textract/AWS is gone; drop boto3"
    assert "psycopg2-binary" not in names and "psycopg2" not in names, "the code uses psycopg 3 only"
    assert names["mcp"].replace(" ", "") == "mcp==2.3.0", "mcp is pinned: MCPServer is 2.x-only"
    assert re.match(r"psycopg\[(binary,pool|pool,binary)\]>=3", names["psycopg"].replace(" ", ""))
    for required in ("fastapi", "uvicorn", "pydantic", "python-dotenv", "python-multipart", "pdf2image",
                     "pytesseract", "pillow", "numpy", "reportlab", "matplotlib", "anthropic",
                     "sqlalchemy", "pgvector", "sentence-transformers", "langgraph",
                     "langgraph-checkpoint-postgres"):
        assert required in names, f"{required} missing from [project].dependencies"
        assert ">=" in names[required] or "==" in names[required], f"{required} needs a version floor"
    assert {_dist_name(d) for d in PYPROJECT["project"]["optional-dependencies"]["dev"]} >= {"pytest", "httpx"}


def test_packaging_config():
    assert PYPROJECT["build-system"]["build-backend"] == "setuptools.build_meta"
    find = PYPROJECT["tool"]["setuptools"]["packages"]["find"]
    include = set(find["include"])
    for pkg in PACKAGES:
        assert pkg in include, f"{pkg} is not in [tool.setuptools.packages.find].include"
        assert (ROOT / pkg).is_dir()
    assert find.get("namespaces") is True, "corpus/ has no __init__.py: namespace discovery must be on"
    assert not {p for p in include if p.split(".")[0] in {"web", "tests", "docs"}}
