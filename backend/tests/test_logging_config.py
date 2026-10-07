"""B61: the app's INFO lines reach the process's output.

Nothing configured the root logger, so the stub email gateway's
"STUB EMAIL …" line (and any other `app.*` INFO record) was dropped before
it reached `docker compose logs backend`."""

import logging

from app.logging_config import FORMAT, configure_logging


def _with_bare_root(fn):
    root = logging.getLogger()
    saved_handlers, saved_level = list(root.handlers), root.level
    for handler in saved_handlers:
        root.removeHandler(handler)
    root.setLevel(logging.WARNING)
    try:
        fn(root)
    finally:
        for handler in list(root.handlers):
            root.removeHandler(handler)
        for handler in saved_handlers:
            root.addHandler(handler)
        root.setLevel(saved_level)


def test_a_bare_root_logger_gets_one_info_handler():
    def check(root):
        assert configure_logging() is True
        assert root.level == logging.INFO
        assert len(root.handlers) == 1
        assert root.handlers[0].formatter._fmt == FORMAT
        assert logging.getLogger("app.email").isEnabledFor(logging.INFO)
        # Idempotent: a second call adds nothing.
        assert configure_logging() is False
        assert len(root.handlers) == 1

    _with_bare_root(check)


def test_an_existing_configuration_is_kept_and_only_opened_to_info():
    def check(root):
        own = logging.StreamHandler()
        root.addHandler(own)
        root.setLevel(logging.WARNING)
        assert configure_logging() is False
        assert root.handlers == [own]
        assert root.level == logging.INFO

    _with_bare_root(check)
