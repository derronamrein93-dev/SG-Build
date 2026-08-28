"""SQLite persistence for RESORSA builds."""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator, Mapping

from .models import EDITABLE_FIELDS, Build, LifecycleStage, ValidationError, utc_now

#: Non-destructive: only ever creates what is missing, never drops or rewrites.
SCHEMA = """
CREATE TABLE IF NOT EXISTS builds (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    target          TEXT NOT NULL DEFAULT '',
    current_state   TEXT NOT NULL DEFAULT '',
    customer        TEXT NOT NULL DEFAULT '',
    problem         TEXT NOT NULL DEFAULT '',
    constraints     TEXT NOT NULL DEFAULT '',
    resources       TEXT NOT NULL DEFAULT '',
    lifecycle_stage TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_builds_updated_at ON builds (updated_at DESC);
"""

_COLUMNS = (
    "id",
    "name",
    "description",
    "target",
    "current_state",
    "customer",
    "problem",
    "constraints",
    "resources",
    "lifecycle_stage",
    "created_at",
    "updated_at",
)


class BuildNotFoundError(LookupError):
    """Raised when an operation names a build id that does not exist."""


def _to_iso(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def _from_iso(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _row_to_build(row: sqlite3.Row) -> Build:
    return Build(
        id=row["id"],
        name=row["name"],
        description=row["description"],
        target=row["target"],
        current_state=row["current_state"],
        customer=row["customer"],
        problem=row["problem"],
        constraints=row["constraints"],
        resources=row["resources"],
        lifecycle_stage=LifecycleStage.coerce(row["lifecycle_stage"]),
        created_at=_from_iso(row["created_at"]),
        updated_at=_from_iso(row["updated_at"]),
    )


class BuildStore:
    """Reads and writes builds in a SQLite database file.

    Each operation opens its own connection, so a store is safe to rebuild at
    any time and two stores pointed at the same file see the same data.
    """

    def __init__(self, db_path: str | Path):
        self.db_path = str(db_path)
        if self.db_path != ":memory:":
            parent = Path(self.db_path).expanduser().resolve().parent
            parent.mkdir(parents=True, exist_ok=True)
            self.db_path = str(Path(self.db_path).expanduser().resolve())
        self.initialize_schema()

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        """Open a connection, commit on success, always close."""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def initialize_schema(self) -> None:
        """Create the schema if it is missing. Existing rows are left alone."""
        with self.connect() as conn:
            conn.executescript(SCHEMA)

    # ------------------------------------------------------------------ CRUD

    def create(self, name: str, **kwargs: Any) -> Build:
        """Insert a new build and return it."""
        build = Build.create(name, **kwargs)
        return self.add(build)

    def add(self, build: Build) -> Build:
        """Insert an already-constructed build and return it."""
        record = _serialise(build)
        placeholders = ", ".join(":" + column for column in _COLUMNS)
        with self.connect() as conn:
            conn.execute(
                f"INSERT INTO builds ({', '.join(_COLUMNS)}) VALUES ({placeholders})",
                record,
            )
        return build

    def get(self, build_id: str) -> Build | None:
        """Return the build with this id, or None if there is no such build."""
        if not isinstance(build_id, str) or not build_id:
            return None
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM builds WHERE id = ?", (build_id,)).fetchone()
        return _row_to_build(row) if row is not None else None

    def list(self) -> list[Build]:
        """Return every build, most recently updated first."""
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM builds ORDER BY updated_at DESC, created_at DESC, id"
            ).fetchall()
        return [_row_to_build(row) for row in rows]

    def update(self, build_id: str, changes: Mapping[str, Any] | None = None, **kwargs: Any) -> Build | None:
        """Apply a partial update and return the stored build.

        Fields that are not named in the update keep their current values, as
        do `id` and `created_at`. Returns None when `build_id` is unknown.
        Raises ValidationError for an invalid lifecycle stage or field name.
        """
        merged: dict[str, Any] = dict(changes or {})
        merged.update(kwargs)
        unknown = set(merged) - set(EDITABLE_FIELDS)
        if unknown:
            raise ValidationError(f"unknown field(s): {', '.join(sorted(unknown))}")

        existing = self.get(build_id)
        if existing is None:
            return None
        if not merged:
            return existing

        updated = existing.with_changes(merged, now=utc_now())
        assignments = ", ".join(f"{name} = :{name}" for name in EDITABLE_FIELDS)
        record = _serialise(updated)
        with self.connect() as conn:
            conn.execute(
                f"UPDATE builds SET {assignments}, updated_at = :updated_at WHERE id = :id",
                record,
            )
        return updated


def _serialise(build: Build) -> dict[str, Any]:
    record: dict[str, Any] = {name: getattr(build, name) for name in _COLUMNS}
    record["lifecycle_stage"] = build.lifecycle_stage.value
    record["created_at"] = _to_iso(build.created_at)
    record["updated_at"] = _to_iso(build.updated_at)
    return record
