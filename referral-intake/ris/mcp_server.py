"""MCP server over the mock RIS.

The point this demonstrates: a RIS is legacy software with no AI story of its own.
An MCP layer lets a model operate it without touching the underlying system - build
over the existing data layer rather than migrating it.

The tools read and write through ris/store.py, the same JSON store the MLLP listener
uses, so orders placed by either side are visible to both.

Run:  python ris/mcp_server.py   (speaks MCP over stdio)
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from mcp.server.fastmcp import FastMCP

from ris import store

mcp = FastMCP("referral-ris")


@mcp.tool()
def search_patient(last_name: str, dob: str | None = None) -> list[dict]:
    """Find patients by last name (and optional date of birth as YYYY-MM-DD).
    Returns one entry per matching patient with their MRN."""
    patients = {}
    for o in store.find_by_patient(last_name, dob):
        patients[o["mrn"]] = {
            "mrn": o["mrn"],
            "last_name": o.get("patient_last_name", ""),
            "first_name": o.get("patient_first_name", ""),
            "dob": o.get("dob", ""),
        }
    return list(patients.values())


@mcp.tool()
def get_orders(mrn: str) -> list[dict]:
    """List all imaging orders for a patient MRN, with each order's status."""
    return [
        {"order_id": o["order_id"], "cpt": o.get("cpt"),
         "description": o.get("description"), "status": o.get("status")}
        for o in store.load().values() if o.get("mrn") == mrn
    ]


@mcp.tool()
def get_order(order_id: str) -> dict | None:
    """Return the full detail of a single order by its order id."""
    return store.load().get(order_id)


@mcp.tool()
def create_order(mrn: str, last_name: str, first_name: str, dob: str,
                 cpt: str, description: str, priority: str = "routine") -> dict:
    """Place a new imaging order in the RIS. dob as YYYY-MM-DD. Returns the created order."""
    orders = store.load()
    order_id = "ORD" + str(len(orders) + 1).zfill(5)
    orders[order_id] = {
        "order_id": order_id,
        "mrn": mrn,
        "patient_last_name": last_name,
        "patient_first_name": first_name,
        "dob": dob.replace("-", ""),
        "cpt": cpt,
        "description": description,
        "priority": priority,
        "status": "scheduled_pending",
    }
    store.save(orders)
    return orders[order_id]


@mcp.tool()
def update_coverage(mrn: str, payor: str, member_id: str) -> dict:
    """Update the insurance on file for every order under a patient MRN."""
    orders = store.load()
    updated = 0
    for o in orders.values():
        if o.get("mrn") == mrn:
            o["payor"] = payor
            o["member_id"] = member_id
            updated += 1
    store.save(orders)
    return {"mrn": mrn, "orders_updated": updated, "payor": payor, "member_id": member_id}


if __name__ == "__main__":
    mcp.run()
