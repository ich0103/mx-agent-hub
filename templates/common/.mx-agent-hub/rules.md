# AX Agent Hub Registration Rules

## Required

- The project must include `agent-hub.json`.
- `agent-hub.json.entry` must point to the HTML file that AX Hub should render.
- The entry HTML must exist.
- Referenced local CSS, JavaScript, image, font, and media assets must exist.
- The app must not contain secret-like values such as API keys, tokens, passwords, or private keys.
- The app must not rely on `localhost`, `127.0.0.1`, `file://`, or developer machine paths.
- The app must run inside an iframe sandbox.
- Large datasets, local databases, dumps, embeddings, and seed files must live under `data/`, `db/`, or `datasets/` so packaging can split them from the code ZIP.
- Entry HTML files such as `index.html` and `main.html` should stay below 5 MB. Do not inline large JSON, CSV, database bytes, or base64 assets into HTML.

## Recommended

- Keep the app static and self-contained.
- Prefer relative asset paths.
- Prefer SQLite (`.sqlite`, `.sqlite3`, `.db`) for app-local relational data, JSONL/CSV for simple datasets, and Parquet for large analytical datasets.
- Use `postMessage` for Hub communication instead of accessing `window.top`.
- Keep the first screen non-empty.
- Provide loading, empty, and error states for user-facing flows.
- Test desktop and mobile widths before packaging.

## Do Not Auto-Fix

Do not automatically change authentication, backend API contracts, secret handling, or business logic. The validator may suggest fixes, but these changes require human review.
