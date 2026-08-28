"""The RESORSA web interface: create, list, open and edit builds."""

from __future__ import annotations

import os
from pathlib import Path

from flask import Flask, abort, flash, redirect, render_template, request, url_for

from ..db import BuildStore
from ..models import EDITABLE_FIELDS, TEXT_FIELDS, Build, LifecycleStage, ValidationError

#: Where the SQLite file lives unless RESORSA_DB says otherwise.
DEFAULT_DB_PATH = Path.cwd() / "resorsa.db"


def create_app(db_path: str | Path | None = None) -> Flask:
    """Build the Flask app. `db_path` overrides the RESORSA_DB environment variable."""
    app = Flask(__name__)
    app.config["SECRET_KEY"] = os.environ.get("RESORSA_SECRET_KEY", "resorsa-dev-secret")
    app.config["DB_PATH"] = str(db_path or os.environ.get("RESORSA_DB") or DEFAULT_DB_PATH)

    store = BuildStore(app.config["DB_PATH"])
    app.config["STORE"] = store

    @app.context_processor
    def template_globals() -> dict[str, object]:
        return {"stages": list(LifecycleStage), "field_names": EDITABLE_FIELDS}

    def _form_values() -> dict[str, str]:
        """Pull the editable fields out of a submitted form."""
        values = {name: request.form.get(name, "").strip() for name in TEXT_FIELDS}
        values["lifecycle_stage"] = request.form.get("lifecycle_stage", LifecycleStage.DEFINE.value)
        return values

    def _load(build_id: str) -> Build:
        build = store.get(build_id)
        if build is None:
            abort(404, description=f"No build with id {build_id}")
        return build

    @app.get("/")
    def index():
        return render_template("index.html", builds=store.list())

    @app.get("/builds/new")
    def new_build():
        return render_template("new.html", values={}, error=None)

    @app.post("/builds")
    def create_build():
        values = _form_values()
        try:
            build = store.create(**values)
        except ValidationError as exc:
            return render_template("new.html", values=values, error=str(exc)), 400
        flash(f"Created build “{build.name}”.")
        return redirect(url_for("show_build", build_id=build.id))

    @app.get("/builds/<build_id>")
    def show_build(build_id: str):
        return render_template("detail.html", build=_load(build_id))

    @app.get("/builds/<build_id>/edit")
    def edit_build(build_id: str):
        build = _load(build_id)
        return render_template("edit.html", build=build, values=build.to_dict(), error=None)

    @app.post("/builds/<build_id>")
    def update_build(build_id: str):
        build = _load(build_id)
        values = _form_values()
        try:
            updated = store.update(build_id, values)
        except ValidationError as exc:
            return render_template("edit.html", build=build, values=values, error=str(exc)), 400
        if updated is None:
            abort(404, description=f"No build with id {build_id}")
        flash(f"Saved build “{updated.name}”.")
        return redirect(url_for("show_build", build_id=build_id))

    @app.errorhandler(404)
    def not_found(error):
        return render_template("404.html", message=getattr(error, "description", "Not found")), 404

    return app
