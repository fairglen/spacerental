"""The API's shape is pinned (Q50).

`openapi_snapshot.json` is the sorted set of every (method, path, operation
id) the app exposes. Splitting the admin routers into a package must not
move a path or rename an operation, and the only acceptable difference in
the schema is the tags — so the comparison deliberately leaves tags out.

Refresh the file on purpose when the API really changes:

    UPDATE_OPENAPI_SNAPSHOT=1 pytest tests/test_openapi_stable.py
"""

import json
import os
from pathlib import Path

from app.main import app

SNAPSHOT = Path(__file__).with_name("openapi_snapshot.json")


def routes_of(application) -> list[dict[str, str]]:
    schema = application.openapi()
    rows = [
        {"method": method.upper(), "path": path, "operation_id": operation["operationId"]}
        for path, methods in schema["paths"].items()
        for method, operation in methods.items()
    ]
    return sorted(rows, key=lambda r: (r["path"], r["method"]))


def test_every_path_method_and_operation_id_matches_the_snapshot():
    current = routes_of(app)
    if os.environ.get("UPDATE_OPENAPI_SNAPSHOT"):
        SNAPSHOT.write_text(json.dumps(current, indent=2, ensure_ascii=False) + "\n")
    expected = json.loads(SNAPSHOT.read_text())
    missing = [r for r in expected if r not in current]
    added = [r for r in current if r not in expected]
    assert not missing and not added, (
        "The API's path/method/operation-id set changed. Missing: "
        f"{missing}; added: {added}. If that is intended, refresh the snapshot "
        "with UPDATE_OPENAPI_SNAPSHOT=1."
    )


def test_the_snapshot_covers_the_admin_surface():
    """A sanity floor so an empty or truncated snapshot cannot pass."""
    expected = json.loads(SNAPSHOT.read_text())
    admin = [r for r in expected if r["path"].startswith("/api/v1/admin/")]
    assert len(admin) >= 60
    assert {r["method"] for r in admin} >= {"GET", "POST", "PUT", "DELETE"}
