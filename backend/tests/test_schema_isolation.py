"""Q57 — the per-test reset is a TRUNCATE, not a schema rebuild.

A test that adds a schema object (the `overlap_constraint` /
`block_overlap_constraint` fixtures add an EXCLUDE constraint the base schema
deliberately lacks — CLAUDE.md §6.5) must carry `fresh_schema`, which rebuilds
the schema before *and* after it. Without that, the added constraint would
outlive the next test's TRUNCATE and break it.

This guard pins the invariant: the schema a test starts on carries no EXCLUDE
constraint. `create_all` builds none (they live only in the migrations), so the
only way one appears here is a leak from such a test — which is exactly what
`fresh_schema`'s rebuild-after prevents. Marked `fresh_schema` so it also starts
from a clean rebuild; it would fail the moment that stopped happening and a
constraint leaked in.
"""

import pytest
from sqlalchemy import text


@pytest.mark.fresh_schema
async def test_the_base_schema_has_no_leaked_exclude_constraint(db_session):
    names = (
        (await db_session.execute(text("SELECT conname FROM pg_constraint WHERE contype = 'x'")))
        .scalars()
        .all()
    )
    assert names == [], f"an EXCLUDE constraint leaked into the base schema: {names}"
