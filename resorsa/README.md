# RESORSA

A small Python web app for tracking **builds** — a piece of work, described in
enough detail that you can see what it is, who it is for, what is in the way,
and how far along it is — through eight lifecycle stages.

This is the first tester-ready vertical slice: a domain model, SQLite
persistence, a test suite, and a minimal web interface. There is no AI or model
integration in this slice.

## Lifecycle stages

`DEFINE` → `CONSTRAIN` → `RESOURCE` → `VALIDATE` → `BUILD` → `TEST` → `IMPROVE` → `SCALE`

A build can sit in any stage; the app does not enforce an order between them.

## The Build model

| Field | Notes |
| --- | --- |
| `id` | Generated hex UUID, assigned at creation, never changes |
| `name` | Required, non-blank |
| `description` | What this build is |
| `target` | What outcome counts as done |
| `current_state` | Where it stands right now |
| `customer` | Who it is for |
| `problem` | What problem it solves for them |
| `constraints` | Time, budget, tech, policy limits |
| `resources` | People, tools, data, money available |
| `lifecycle_stage` | One of the eight stages above; anything else is rejected |
| `created_at` | UTC timestamp, set at creation, never changes |
| `updated_at` | UTC timestamp, refreshed on every update |

Every field except `id`, `created_at` and `updated_at` is editable. Updates are
partial: fields you do not name keep their current values.

---

## Running it on Windows

The commands below are written for a fresh checkout on Windows. **They have not
been executed on Windows** — this slice was developed and its tests were run on
Linux, so treat the Windows run as the first real test.

You need Python 3.11 or newer (`py -3 --version` to check).

### 1. Set up (once)

Open **PowerShell** in the folder containing this README (`...\SG-Build\resorsa`):

```powershell
cd resorsa
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

If PowerShell blocks the activation script, either run this once in the same
window:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

…or use **Command Prompt (cmd.exe)** instead, where activation is:

```bat
cd resorsa
py -3 -m venv .venv
.venv\Scripts\activate.bat
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

### 2. Run the tests

From `...\SG-Build\resorsa`, with the virtual environment activated:

```powershell
python -m pytest
```

For per-test detail:

```powershell
python -m pytest -v
```

Tests use their own throwaway SQLite files in a temp directory. They never touch
`resorsa.db`.

### 3. Run the app

From `...\SG-Build\resorsa`, with the virtual environment activated:

```powershell
python run.py
```

Then open <http://127.0.0.1:5000/> in a browser.

Stop the server with `Ctrl+C`.

### What you can do in the browser

- **`/`** — list every build, most recently updated first
- **New build** — fill in the form, submit, land on the new build's page
- **Click a build name** — open it and read every field
- **Edit** — change any field and save; untouched fields are left alone

The database file `resorsa.db` is created in whatever folder you run `python
run.py` from. Deleting it resets the app to empty. Re-running the app never
drops or rewrites existing data — schema setup is `CREATE TABLE IF NOT EXISTS`
only.

### Optional settings

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `RESORSA_DB` | `resorsa.db` in the current folder | Where the SQLite file lives |
| `RESORSA_PORT` | `5000` | Port the dev server listens on |
| `RESORSA_HOST` | `127.0.0.1` | Interface the dev server binds to |

To use a different port in PowerShell:

```powershell
$env:RESORSA_PORT = "5050"
python run.py
```

`python run.py` starts Flask's development server with debug mode on. It is for
local testing only, not for deployment.

---

## Project layout

```
resorsa/
├── README.md
├── requirements.txt        Flask + pytest, pinned
├── pyproject.toml          pytest configuration
├── run.py                  dev entry point
├── resorsa/
│   ├── models.py           Build dataclass, LifecycleStage, validation
│   ├── db.py               BuildStore — SQLite create/get/list/update
│   └── web/
│       ├── app.py          Flask app factory and routes
│       ├── templates/      Jinja templates
│       └── static/         stylesheet
└── tests/
    ├── conftest.py         temp-database and test-client fixtures
    ├── test_models.py      model validation and copy-on-change
    ├── test_store.py       persistence, partial updates, unknown ids
    └── test_web.py         create / list / open / edit through HTTP
```

## Routes

| Method | Path | Does |
| --- | --- | --- |
| `GET` | `/` | List builds |
| `GET` | `/builds/new` | Create form |
| `POST` | `/builds` | Create a build |
| `GET` | `/builds/<id>` | Open a build |
| `GET` | `/builds/<id>/edit` | Edit form |
| `POST` | `/builds/<id>` | Save an edit |

An unknown build id returns 404 rather than an error page. An invalid lifecycle
stage or a blank name re-renders the form with a message and a 400 status; the
database is left untouched.

## Not in this slice

- Local Ollama / any model integration
- Deleting builds
- Authentication, multi-user, or any access control
- Anything beyond Flask's development server
