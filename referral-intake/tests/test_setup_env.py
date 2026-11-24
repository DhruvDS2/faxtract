""".env.example lists exactly the environment variables the code reads.

The list is docs/CONTRACTS.md section 3. Three checks keep the three in step:
  * .env.example == the section 3 list (and that list matches the doc's table);
  * no Python module reads a variable that is not declared;
  * every declared variable is read somewhere, apart from the ones only an SDK
    reads (listed in SDK_IMPLICIT).

"Read" means os.getenv("X"), getenv("X"), os.environ.get("X"), os.environ["X"]
(load, not assignment) and "X" in os.environ, found by walking the AST of every
.py file under referral-intake/ except tests/ and generated or vendored
directories. Writes (os.environ["X"] = ..., setdefault, pop) are not reads, so
graph/ switching LangSmith tracing off doesn't count.
"""
import ast
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent          # referral-intake/
CONTRACTS_MD = ROOT.parent / "docs" / "CONTRACTS.md"

# docs/CONTRACTS.md section 3, in table order.
CONTRACT_VARS = [
    "DATABASE_URL",
    "PIPELINE",
    "EXTRACTOR",
    "ANTHROPIC_API_KEY",
    "CONFIDENCE_THRESHOLD",
    "RIS_MLLP_HOST",
    "RIS_MLLP_PORT",
    "RIS_STORE_PATH",
    "RIS_FAULT_LAST_NAMES",
    "REPLAY_PACE_S",
    "UPLOADS_DIR",
    "POPPLER_PATH",
    "HF_HUB_OFFLINE",
]

# Who reads each one (section 3's "Read by" column), for the failure messages.
READ_BY = {
    "DATABASE_URL": "app/db.py",
    "PIPELINE": "app/contracts.py (pipeline_name)",
    "EXTRACTOR": "app/extract.py",
    "CONFIDENCE_THRESHOLD": "app/contracts.py (confidence_threshold)",
    "RIS_MLLP_HOST": "app/hl7.py client + ris/server.py listener (Lane A)",
    "RIS_MLLP_PORT": "app/hl7.py client + ris/server.py listener (Lane A)",
    "RIS_STORE_PATH": "ris/server.py, ris/store.py",
    "RIS_FAULT_LAST_NAMES": "ris/server.py (Lane A)",
    "REPLAY_PACE_S": "the API's upload default (Lane A)",
    "UPLOADS_DIR": "the API (Lane A)",
    "POPPLER_PATH": "app/extract.py",
}
# Removed by the amendment; a read of one of these is a leftover.
GONE = {"PREVIEW_DPI", "HIGHLIGHT", "LANDING_API_KEY", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY",
        "AWS_REGION", "AWS_DEFAULT_REGION", "AWS_PROFILE", "TEXTRACT_REGION"}

# Declared in .env.example but read by a library rather than our code, so no
# os.getenv for them has to exist.
SDK_IMPLICIT = {
    "ANTHROPIC_API_KEY": "the anthropic SDK reads it when Anthropic() is built",
    "HF_HUB_OFFLINE": "huggingface_hub reads it (sentence-transformers model loading)",
}

# Read by code but deliberately not in .env.example: test-harness settings.
TEST_HARNESS = {
    "TEST_DATABASE_URL": "the Postgres server pytest's `db` fixture creates databases on "
                         "(tests/conftest.py); `make test` (scripts/demo.py) sets it",
}

SKIP_DIRS = {"tests", "web", "node_modules", ".venv", "venv", ".demo", "build", "dist",
             "__pycache__", ".git", ".pytest_cache"}


def env_example_vars(path=ROOT / ".env.example") -> list[str]:
    names = []
    for line in path.read_text().splitlines():
        m = re.match(r"\s*([A-Za-z_][A-Za-z0-9_]*)\s*=", line)
        if m and not line.lstrip().startswith("#"):
            names.append(m.group(1))
    return names


def _is_environ(node) -> bool:
    return (isinstance(node, ast.Attribute) and node.attr == "environ") or (
        isinstance(node, ast.Name) and node.id == "environ")


def _const_str(node):
    return node.value if isinstance(node, ast.Constant) and isinstance(node.value, str) else None


def env_reads_in_source(source: str, filename: str = "<src>") -> dict[str, list[str]]:
    """{VAR: ["file:line", ...]} for every literal env-var read in `source`."""
    found: dict[str, list[str]] = {}

    def hit(name, node):
        if name:
            found.setdefault(name, []).append(f"{filename}:{node.lineno}")

    for node in ast.walk(ast.parse(source, filename)):
        if isinstance(node, ast.Call) and node.args:
            f = node.func
            if (isinstance(f, ast.Attribute) and f.attr == "getenv") or (
                    isinstance(f, ast.Name) and f.id == "getenv"):
                hit(_const_str(node.args[0]), node)
            elif isinstance(f, ast.Attribute) and f.attr == "get" and _is_environ(f.value):
                hit(_const_str(node.args[0]), node)
        elif isinstance(node, ast.Subscript) and isinstance(node.ctx, ast.Load) and _is_environ(node.value):
            hit(_const_str(node.slice), node)
        elif isinstance(node, ast.Compare) and any(isinstance(op, (ast.In, ast.NotIn)) for op in node.ops):
            if any(_is_environ(c) for c in node.comparators):
                hit(_const_str(node.left), node)
    return found


def python_files(root: Path = ROOT):
    for path in sorted(root.rglob("*.py")):
        rel = path.relative_to(root)
        if any(part in SKIP_DIRS or part.endswith(".egg-info") for part in rel.parts[:-1]):
            continue
        yield path


def env_reads(root: Path = ROOT) -> dict[str, list[str]]:
    reads: dict[str, list[str]] = {}
    for path in python_files(root):
        rel = str(path.relative_to(root))
        for name, where in env_reads_in_source(path.read_text(), rel).items():
            reads.setdefault(name, []).extend(where)
    return reads


# ---------------------------------------------------------------------------


def test_env_example_lists_exactly_the_contract_vars():
    declared = env_example_vars()
    dupes = sorted({v for v in declared if declared.count(v) > 1})
    assert not dupes, f".env.example declares these more than once: {dupes}"
    missing = [v for v in CONTRACT_VARS if v not in declared]
    extra = [v for v in declared if v not in CONTRACT_VARS]
    assert not missing and not extra, (
        f".env.example must list exactly CONTRACTS section 3. Missing: {missing}. "
        f"Not in the contract: {extra}.")


def test_contract_list_matches_contracts_md():
    assert CONTRACTS_MD.exists(), f"{CONTRACTS_MD} not found (this test mirrors its section 3)"
    text = CONTRACTS_MD.read_text()
    section = re.search(r"^## 3\..*?$(.*?)^## 4\.", text, re.S | re.M)
    assert section, "could not find section 3 in docs/CONTRACTS.md"
    names = []
    for line in section.group(1).splitlines():
        if line.startswith("| `"):
            first_cell = line.split("|")[1]
            names += re.findall(r"`([A-Z][A-Z0-9_]+)`", first_cell)
    assert names == CONTRACT_VARS, (
        "CONTRACT_VARS in this test no longer matches docs/CONTRACTS.md section 3: "
        f"doc has {names}")


def test_env_example_is_well_formed():
    lines = (ROOT / ".env.example").read_text().splitlines()
    values = {}
    for i, line in enumerate(lines):
        m = re.match(r"([A-Z][A-Z0-9_]*)=(.*)$", line)
        if not m:
            continue
        name, value = m.groups()
        values[name] = value
        assert " #" not in value and "\t#" not in value, (
            f".env.example:{i + 1}: no inline comments (hand-rolled loaders keep them as part of the value)")
        # every variable sits in a block that starts with a comment line
        j = i - 1
        while j >= 0 and re.match(r"[A-Z][A-Z0-9_]*=", lines[j]):
            j -= 1
        assert j >= 0 and lines[j].startswith("#"), f".env.example:{i + 1}: {name} needs a one-line comment above it"
    assert values["ANTHROPIC_API_KEY"] == "", ".env.example must not contain a key"
    url = values["DATABASE_URL"]
    assert url.startswith("postgresql+psycopg://") and url.endswith("/faxtract"), url
    assert ":" not in url.split("://", 1)[1].split("@")[0], "example DATABASE_URL must not carry a password"


def test_code_reads_only_declared_vars():
    declared = set(env_example_vars())
    undeclared = {name: where for name, where in env_reads().items()
                  if name not in declared and name not in TEST_HARNESS}
    assert not undeclared, (
        "code reads environment variables that are not in .env.example / CONTRACTS section 3 "
        "(declare them via the orchestrator, or stop reading them): "
        + "; ".join(f"{n} at {', '.join(w)}" + (" (removed by the amendment, CONTRACTS section 3 'Gone')"
                                                 if n in GONE else "")
                    for n, w in sorted(undeclared.items())))


def test_every_declared_var_is_read():
    reads = env_reads()
    unread = [v for v in env_example_vars() if v not in reads and v not in SDK_IMPLICIT]
    assert not unread, (
        "declared in .env.example (CONTRACTS section 3) but no module reads them: "
        + "; ".join(f"{v} (should be read by {READ_BY.get(v, '?')})" for v in unread))


def test_scanner_sees_every_read_form_and_ignores_writes():
    src = '''
import os
from os import environ, getenv
a = os.getenv("A1")
b = os.getenv("A2", "x")
c = getenv("A3")
d = os.environ.get("A4")
e = os.environ["A5"]
f = environ["A6"]
if "A7" in os.environ: pass
if "A8" not in environ: pass
os.environ["W1"] = "x"
os.environ.setdefault("W2", "x")
os.environ.pop("W3", None)
del os.environ["W4"]
name = "dyn"; os.getenv(name)
'''
    assert set(env_reads_in_source(src)) == {f"A{i}" for i in range(1, 9)}
