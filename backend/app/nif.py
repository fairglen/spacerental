"""The Portuguese NIF (número de identificação fiscal), as an invoice names it.

Nine digits whose last one is a mod-11 check digit over the first eight
(weights 9 down to 2; remainder 0 or 1 → 0, else 11 - remainder). A leading
zero is not issued. The prefix classes (1-3 individuals, 5 companies, …) are
not policed here: the AT's list changes and the operator can read the number
they were given. Spaces are tolerated on the way in and gone on the way out.
"""

import re

_DIGITS = re.compile(r"^[1-9]\d{8}$")


def normalise(value: str | None) -> str | None:
    """`" 123 456 789 "` → `"123456789"`; blank → None."""
    if value is None:
        return None
    cleaned = re.sub(r"\s+", "", value)
    return cleaned or None


def is_valid(value: str) -> bool:
    if not _DIGITS.match(value):
        return False
    digits = [int(c) for c in value]
    remainder = sum(d * w for d, w in zip(digits[:8], range(9, 1, -1), strict=True)) % 11
    check = 0 if remainder < 2 else 11 - remainder
    return digits[8] == check


def validate(value: str | None) -> str | None:
    """Pydantic-side: a normalised, valid NIF or None; raises on anything else."""
    cleaned = normalise(value)
    if cleaned is None:
        return None
    if not is_valid(cleaned):
        raise ValueError("NIF inválido")
    return cleaned
