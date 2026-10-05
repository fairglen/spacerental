"""The deletion policy's shared pieces (G02).

Every hard delete, the membership removal and anonymisation take
`confirm=<entity name or short id>`: the short id is the first eight hex
characters of the uuid, what the panel shows next to a row. A missing or
mismatched confirm is a 422 that changes nothing.
"""

import uuid

from fastapi import HTTPException, status


def short_id(entity_id: uuid.UUID) -> str:
    return entity_id.hex[:8]


def require_confirm(confirm: str | None, entity_id: uuid.UUID, *names: str | None) -> None:
    # Case does not matter: the panel shows a support reference as `3F9A12BC`
    # and a short id as `3f9a12bc`, and a person types what they see.
    accepted = {short_id(entity_id), *(n.strip().lower() for n in names if n)}
    if confirm is None or confirm.strip().lower() not in accepted:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="confirm must be the entity's name or its short id",
        )


def blocked(message: str, blockers) -> HTTPException:
    """409 with what stands in the way, so the panel can show the way out."""
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT, detail={"message": message, "blockers": blockers}
    )
