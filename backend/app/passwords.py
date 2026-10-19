"""The password policy (B66), after NIST SP 800-63B: length and blocklists,
no composition rules.

One function, `check_password`, used by every route that accepts a new
password — register, reset, set-password, the admin's set-password — so
the rules cannot drift between them. It returns the reasons a password is
refused, in formal Portuguese, and the route answers 422 with that list;
`frontend/lib/password.ts` mirrors the length and email rules for an
inline hint, the breached list stays here.

Rules:
- 10 to 128 characters (NIST: at least 8, allow at least 64; longer is
  cheaper to remember than complex);
- not in the bundled list of the 20 000 most common breached passwords
  (`data/common-passwords.txt`, SecLists' xato-net top 100 000, lowercased
  and de-duplicated; compared case-insensitively, loaded once);
- not containing the address's local part (4+ characters) or the product's
  name — the context-specific words NIST says to refuse.

No character-class rule, by decision: it pushes people to `Password1!`,
which the list refuses anyway.
"""

from functools import lru_cache
from pathlib import Path

MIN_LENGTH = 10
MAX_LENGTH = 128
# Below this a local part is too short to be a meaningful secret fragment
# (`a@x.pt` would forbid every password with an "a").
MIN_LOCAL_PART = 4
PRODUCT_WORD = "flowspace"
COMMON_PASSWORDS_FILE = Path(__file__).parent / "data" / "common-passwords.txt"

LENGTH_MESSAGE = f"A password tem de ter entre {MIN_LENGTH} e {MAX_LENGTH} caracteres."
COMMON_MESSAGE = (
    "Esta password é demasiado comum: consta de listas de passwords expostas "
    "em fugas de dados. Escolha outra."
)
EMAIL_MESSAGE = "A password não pode conter a parte do seu email antes do @."
PRODUCT_MESSAGE = f'A password não pode conter "{PRODUCT_WORD}".'


@lru_cache(maxsize=1)
def common_passwords() -> frozenset[str]:
    with COMMON_PASSWORDS_FILE.open(encoding="utf-8") as handle:
        return frozenset(line.rstrip("\n") for line in handle if line.strip())


def email_local_part(email: str) -> str:
    return email.split("@", 1)[0].strip().lower()


def check_password(password: str, email: str) -> list[str]:
    """Why `password` is refused for the account `email`; empty when it is fine."""
    reasons: list[str] = []
    if not MIN_LENGTH <= len(password) <= MAX_LENGTH:
        reasons.append(LENGTH_MESSAGE)
    lowered = password.lower()
    if lowered in common_passwords():
        reasons.append(COMMON_MESSAGE)
    local = email_local_part(email)
    if len(local) >= MIN_LOCAL_PART and local in lowered:
        reasons.append(EMAIL_MESSAGE)
    if PRODUCT_WORD in lowered:
        reasons.append(PRODUCT_MESSAGE)
    return reasons
