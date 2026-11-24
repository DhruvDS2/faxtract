"""Per-node trace events (app.trace, Postgres) for the served graph.

traced() wraps a node body so that every execution writes two rows:

    running                       when the node starts (no state, no delta)
    ok | error | interrupted      when it ends, with duration, cost/tokens, attempt,
                                  branch (the node chosen next), state_in and delta

LangGraph re-runs an interrupted node from the top when it is resumed. So a
pause reads as  human_review running -> interrupted  in the run that paused,
and  human_review running -> ok (branch=order)  in the run that resumed it.

The wrapper also adds two bookkeeping keys to the node's update
(stage_timings_ms, node_runs); the trace's delta is the node body's own update.
"""
import json
import logging
import time
from typing import Callable

from langgraph.errors import GraphInterrupt
from langgraph.graph import END

from app.contracts import TraceEvent, token_cost, utcnow
from graph.state import BOOKKEEPING

log = logging.getLogger(__name__)

RUN_ID_KEY = "trace_run_id"  # config["configurable"][RUN_ID_KEY], one per start()/resume()


def json_safe(value):
    return json.loads(json.dumps(value, default=str))


def without_boxes(state: dict | None) -> dict | None:
    """JSON-safe copy without bookkeeping keys and without referral.boxes."""
    if state is None:
        return None
    out = {k: v for k, v in dict(state).items() if k not in BOOKKEEPING}
    if isinstance(out.get("referral"), dict):
        out["referral"] = {k: v for k, v in out["referral"].items() if k != "boxes"}
    return json_safe(out)


def _interrupt_value(exc: GraphInterrupt):
    try:
        interrupts = exc.args[0]
        return json_safe(interrupts[0].value)
    except Exception:  # pragma: no cover - shape differs across langgraph versions
        return None


def _emit(event: TraceEvent) -> None:
    from app import trace

    try:
        trace.emit(event)
    except Exception:  # a trace row must never take a referral down with it
        log.exception("trace emit failed for %s/%s", event.referral_id, event.node)


def traced(name: str, body: Callable[[dict], dict], *,
           router: Callable[[dict], str] | None = None,
           path_map: dict[str, str] | None = None,
           next_node: str | None = None,
           detail: Callable[[dict, dict], dict] | None = None,
           attempt_of: Callable[[dict], int] | None = None):
    """Return a LangGraph node function that runs `body` and traces it.

    router/path_map: the node's conditional edge, used to record the branch taken.
    next_node: the fixed successor for nodes with a plain edge.
    detail(state, delta): a small JSON summary for the closing event.
    attempt_of(state): the attempt number (default: how many times this node has run).
    """

    def node(state, config):
        configurable = (config or {}).get("configurable", {})
        run_id = configurable.get(RUN_ID_KEY) or "untraced"
        referral_id = state.get("referral_id", "?")
        runs = (state.get("node_runs") or {}).get(name, 0) + 1
        attempt = attempt_of(state) if attempt_of else runs
        started = utcnow()
        t0 = time.perf_counter()

        def close(status, *, branch=None, delta=None, error=None, extra=None, usage=None):
            usage = usage or {}
            _emit(TraceEvent(
                referral_id=referral_id, run_id=run_id, pipeline="graph", node=name,
                status=status, started_at=started,
                duration_ms=round((time.perf_counter() - t0) * 1000, 3),
                cost_usd=token_cost(usage), tokens_in=int(usage.get("input_tokens", 0) or 0),
                tokens_out=int(usage.get("output_tokens", 0) or 0),
                attempt=attempt, branch=branch, detail=json_safe(extra or {}), error=error,
                state_in=without_boxes(state), delta=without_boxes(delta) if delta is not None else None,
            ))

        _emit(TraceEvent(referral_id=referral_id, run_id=run_id, pipeline="graph", node=name,
                         status="running", started_at=started, duration_ms=0.0, attempt=attempt))
        try:
            delta = body(state) or {}
        except GraphInterrupt as exc:
            close("interrupted", extra={"waiting_for": _interrupt_value(exc)})
            raise
        except Exception as exc:
            close("error", error=f"{type(exc).__name__}: {exc}")
            raise

        merged = {**state, **delta}
        if router is not None:
            label = router(merged)
            branch = path_map[label]
        else:
            label, branch = None, next_node
        extra = detail(merged, delta) if detail else {}
        if label is not None:
            extra = {"route": label, **extra}
        failed = delta.get("status") in ("failed", "ris_error")
        close("error" if failed else "ok", branch=branch, delta=delta,
              error=delta.get("error") if failed else None, extra=extra,
              usage=delta.get("usage") if name == "extract" else None)

        out = dict(delta)
        out["stage_timings_ms"] = {name: round((time.perf_counter() - t0) * 1000, 3)}
        out["node_runs"] = {name: runs}
        return out

    node.__name__ = f"{name}_node"
    return node


__all__ = ["END", "RUN_ID_KEY", "traced", "without_boxes", "json_safe"]
