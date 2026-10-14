"""One mailbox, one account (B67, closing B37).

`users.email` keeps the address as the person typed it — it is what we send
to — and `users.email_normalized` is the identity we compare: trimmed and
lowercased, the `+tag` dropped from the local part on every domain
(subaddressing is universal: `ana+flowspace@x.pt` and `ana@x.pt` are one
mailbox), and for Gmail the dots in the local part removed (`an.a@gmail.com`
delivers to `ana@gmail.com`). The model keeps the column in step with
`email` (`User.email`'s validator), so every code path that sets an address
gets the normalised one for free; migration 0019 backfilled the existing
rows with the same rule in SQL and refuses to run on a collision.

DECISION: subaddressing is folded, not refused. A `+` is a legitimate part of
an address and refusing it would block real people; folding it means the
second sign-up with a tag is told the account already exists.
"""

GMAIL_DOMAINS = frozenset({"gmail.com", "googlemail.com"})


def normalize_email(email: str) -> str:
    lowered = email.strip().lower()
    local, at, domain = lowered.rpartition("@")
    if not at:
        return lowered
    local = local.split("+", 1)[0]
    if domain in GMAIL_DOMAINS:
        local = local.replace(".", "")
    return f"{local}@{domain}"
