"""Make the app's own log lines visible (B61).

uvicorn configures its own loggers (`uvicorn`, `uvicorn.access`) and nothing
configured the root logger, so every `app.*` record below WARNING — the stub
email gateway's "STUB EMAIL …" line, the startup mode line — was dropped
before it reached `docker compose logs backend`. One handler on the root
logger at INFO, added only when nothing has configured logging yet (pytest
and a deployment with its own configuration keep theirs).
"""

import logging

FORMAT = "%(levelname)s %(name)s: %(message)s"


def configure_logging(level: int = logging.INFO) -> bool:
    """Attach a stream handler to the root logger if it has none. Returns
    whether this call did the configuring."""
    root = logging.getLogger()
    if root.handlers:
        if root.level == logging.NOTSET or root.level > level:
            root.setLevel(level)
        return False
    logging.basicConfig(level=level, format=FORMAT)
    return True
