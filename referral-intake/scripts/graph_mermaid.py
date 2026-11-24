"""Print the served graph as a Mermaid flowchart, introspected from the compiled
LangGraph (graph.service.structure()) -- the README diagram is generated, not drawn.

Run: PYTHONPATH=. python -m scripts.graph_mermaid
"""
from graph.service import structure


def mermaid() -> str:
    s = structure()
    lines = ["flowchart TD"]
    for n in s.nodes:
        if n.kind == "start":
            lines.append(f"    {n.id}([start])")
        elif n.kind == "end":
            lines.append(f"    {n.id}([end])")
        elif n.interrupts:
            lines.append(f"    {n.id}{{{{\"{n.label} ⏸\"}}}}")
        else:
            lines.append(f"    {n.id}[\"{n.label}\"]")
    for e in s.edges:
        arrow = f"-.{e.label}.->" if e.conditional and e.label else ("-.->" if e.conditional else "-->")
        lines.append(f"    {e.source} {arrow} {e.target}")
    pausing = [n.id for n in s.nodes if n.interrupts]
    lines.append("    classDef pause fill:#fffbeb,stroke:#b45309,color:#b45309")
    if pausing:
        lines.append(f"    class {','.join(pausing)} pause")
    return "\n".join(lines)


if __name__ == "__main__":
    print(mermaid())
