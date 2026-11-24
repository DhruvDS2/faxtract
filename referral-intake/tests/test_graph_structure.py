"""GET /graph/structure comes from the compiled graph, never a hand-written list."""
import os

from graph.pipeline import build_graph
from graph.service import structure

REQUIRED = {"extract", "validate", "eligibility", "auth", "retrieve", "packet", "human_review", "order"}


def test_structure_matches_the_compiled_graph():
    drawn = build_graph().get_graph()
    s = structure()

    assert [n.id for n in s.nodes] == list(drawn.nodes)
    assert {(e.source, e.target, e.conditional) for e in s.edges} == {
        (e.source, e.target, bool(e.conditional)) for e in drawn.edges}
    assert len(s.edges) == len(drawn.edges)

    ids = {n.id for n in s.nodes}
    assert REQUIRED <= ids
    assert {"__start__", "__end__"} <= ids
    kinds = {n.id: n.kind for n in s.nodes}
    assert kinds["__start__"] == "start" and kinds["__end__"] == "end" and kinds["order"] == "node"


def test_interrupting_nodes_are_marked():
    marked = {n.id for n in structure().nodes if n.interrupts}
    assert marked == {"human_review", "ris_wait"}


def test_conditional_edges_are_labelled_with_their_branch():
    edges = {(e.source, e.target): e for e in structure().edges}
    for e in edges.values():
        assert (e.label is not None) == e.conditional
    assert edges[("human_review", "order")].label == "approve"
    assert edges[("human_review", "validate")].label == "edit"
    assert edges[("human_review", "reject")].label == "reject"
    assert edges[("auth", "retrieve")].label == "auth required"
    assert edges[("auth", "order")].label == "auto"
    assert not edges[("eligibility", "auth")].conditional  # coverage never skips auth
    assert ("eligibility", "human_review") not in edges
    assert edges[("order", "ris_wait")].label == "ris error"
    assert edges[("ris_wait", "order")].label == "retry"
    assert not edges[("retrieve", "packet")].conditional


def test_active_pipeline_follows_PIPELINE(monkeypatch):
    monkeypatch.setenv("PIPELINE", "v1")
    assert structure().active_pipeline == "v1"
    monkeypatch.delenv("PIPELINE")
    assert structure().active_pipeline == "graph"


def test_langsmith_tracing_is_forced_off():
    import graph  # noqa: F401

    assert os.environ["LANGSMITH_TRACING"] == "false"
    assert os.environ["LANGCHAIN_TRACING_V2"] == "false"
