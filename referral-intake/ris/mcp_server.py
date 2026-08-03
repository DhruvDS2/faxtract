"""MCP server over the mock RIS.

The point this demonstrates: a RIS is legacy software with no AI story of its own.
An MCP layer lets a model operate it without touching the underlying system - build
over the existing data layer rather than migrating it.

TODO(claude-code): implement with the mcp python sdk. Tools:
  search_patient(last_name, dob)     -> matching patients with MRNs
  get_orders(mrn)                    -> orders with status
  get_order(order_id)                -> full order detail
  create_order(...)                  -> places an order, returns order id
  update_coverage(mrn, payor, member_id)

Read and write through ris/store.py so the MCP server and the MLLP listener share state.
"""
