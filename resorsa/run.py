"""Development entry point: python run.py"""

from __future__ import annotations

import os

from resorsa.web import create_app

app = create_app()

if __name__ == "__main__":
    app.run(
        host=os.environ.get("RESORSA_HOST", "127.0.0.1"),
        port=int(os.environ.get("RESORSA_PORT", "5000")),
        debug=True,
    )
