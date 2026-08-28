"""Domain model for RESORSA builds."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field, fields, replace
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Mapping


class ValidationError(ValueError):
    """Raised when a Build cannot be constructed or updated as requested."""


class LifecycleStage(str, Enum):
    """The eight stages a build moves through."""

    DEFINE = "DEFINE"
    CONSTRAIN = "CONSTRAIN"
    RESOURCE = "RESOURCE"
    VALIDATE = "VALIDATE"
    BUILD = "BUILD"
    TEST = "TEST"
    IMPROVE = "IMPROVE"
    SCALE = "SCALE"

    @classmethod
    def coerce(cls, value: Any) -> "LifecycleStage":
        """Turn a stage name or LifecycleStage into a LifecycleStage.

        Raises ValidationError for anything that is not one of the eight stages.
        """
        if isinstance(value, cls):
            return value
        if isinstance(value, str):
            try:
                return cls(value.strip().upper())
            except ValueError:
                pass
        valid = ", ".join(stage.value for stage in cls)
        raise ValidationError(f"invalid lifecycle_stage {value!r}; expected one of: {valid}")


#: Field names a caller may set on a Build, in display order.
EDITABLE_FIELDS = (
    "name",
    "description",
    "target",
    "current_state",
    "customer",
    "problem",
    "constraints",
    "resources",
    "lifecycle_stage",
)

#: The free-text fields, i.e. everything editable except the lifecycle stage.
TEXT_FIELDS = tuple(name for name in EDITABLE_FIELDS if name != "lifecycle_stage")


def utc_now() -> datetime:
    """Current time, timezone-aware and in UTC."""
    return datetime.now(timezone.utc)


def new_build_id() -> str:
    """A fresh opaque build identifier."""
    return uuid.uuid4().hex


@dataclass(frozen=True)
class Build:
    """A single build being tracked through the RESORSA lifecycle."""

    id: str
    name: str
    description: str = ""
    target: str = ""
    current_state: str = ""
    customer: str = ""
    problem: str = ""
    constraints: str = ""
    resources: str = ""
    lifecycle_stage: LifecycleStage = LifecycleStage.DEFINE
    created_at: datetime = field(default_factory=utc_now)
    updated_at: datetime = field(default_factory=utc_now)

    def __post_init__(self) -> None:
        # Normalise and validate through object.__setattr__ because the
        # dataclass is frozen.
        object.__setattr__(self, "lifecycle_stage", LifecycleStage.coerce(self.lifecycle_stage))
        for name in TEXT_FIELDS:
            value = getattr(self, name)
            object.__setattr__(self, name, "" if value is None else str(value))
        if not self.name.strip():
            raise ValidationError("name is required")

    @classmethod
    def create(cls, name: str, **kwargs: Any) -> "Build":
        """Build a new instance with a generated id and matching timestamps."""
        now = utc_now()
        unknown = set(kwargs) - set(EDITABLE_FIELDS)
        if unknown:
            raise ValidationError(f"unknown field(s): {', '.join(sorted(unknown))}")
        return cls(id=new_build_id(), name=name, created_at=now, updated_at=now, **kwargs)

    def with_changes(self, changes: Mapping[str, Any], *, now: datetime | None = None) -> "Build":
        """Return a copy with `changes` applied; untouched fields are preserved.

        Only the editable fields may be changed. `updated_at` is refreshed;
        `id` and `created_at` are never altered.
        """
        unknown = set(changes) - set(EDITABLE_FIELDS)
        if unknown:
            raise ValidationError(f"unknown field(s): {', '.join(sorted(unknown))}")
        applied = dict(changes)
        if "lifecycle_stage" in applied:
            applied["lifecycle_stage"] = LifecycleStage.coerce(applied["lifecycle_stage"])
        return replace(self, updated_at=now or utc_now(), **applied)

    def to_dict(self) -> dict[str, Any]:
        """A plain-dict view, handy for templates and assertions."""
        out: dict[str, Any] = {}
        for f in fields(self):
            value = getattr(self, f.name)
            if isinstance(value, LifecycleStage):
                value = value.value
            elif isinstance(value, datetime):
                value = value.isoformat()
            out[f.name] = value
        return out
