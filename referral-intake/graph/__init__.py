"""v2: the served pipeline, a LangGraph running locally.

    graph.pipeline   nodes, routing and build_graph()
    graph.service    setup(), structure(), GraphRunner (the PipelineRunner the API serves)
    graph.state      the graph's state (JSON-native, so checkpoints and trace diffs are plain JSON)

v1 lives in app/pipeline.py and is left untouched as the benchmark baseline.

No LangSmith and no LangChain-hosted services: tracing is app.trace (Postgres).
These are forced off before anything imports langchain/langgraph.
"""
import os

os.environ["LANGSMITH_TRACING"] = "false"
os.environ["LANGCHAIN_TRACING_V2"] = "false"
