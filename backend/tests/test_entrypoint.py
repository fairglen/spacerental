"""Exercise entrypoint failure guidance without Docker or a database."""

import os
import subprocess
import tempfile
import unittest
from pathlib import Path


def check_migration_entrypoint(tmp_path, error):
    alembic = tmp_path / "alembic"
    alembic.write_text('#!/bin/sh\nprintf "%s\\n" "$MIGRATION_ERROR"\n[ -z "$MIGRATION_ERROR" ]\n')
    alembic.chmod(0o755)
    marker = tmp_path / "started"
    result = subprocess.run(
        ["sh", str(Path(__file__).parents[1] / "docker-entrypoint.sh"), "touch", str(marker)],
        check=False,
        env={**os.environ, "PATH": f"{tmp_path}:{os.environ['PATH']}", "MIGRATION_ERROR": error},
        capture_output=True,
        text=True,
    )
    assert result.returncode == (1 if error else 0)
    assert marker.exists() == (not error)
    if error.startswith("Duplicate"):
        assert "one possible" in result.stderr
        assert "backend current" in result.stderr
        assert "run --rm --entrypoint alembic backend stamp head" in result.stderr
        assert "database has no 'alembic_version'" not in result.stderr
    else:
        assert "stamp head" not in result.stderr
    if error:
        assert error in result.stderr


class EntrypointTests(unittest.TestCase):
    def test_migration_outcomes(self):
        for error in ("DuplicateObjectError", "DuplicateTableError", "connection refused", ""):
            with self.subTest(error=error), tempfile.TemporaryDirectory() as directory:
                check_migration_entrypoint(Path(directory), error)
