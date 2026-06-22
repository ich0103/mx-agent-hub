# AX Agent Hub Registration Checklist

- [ ] `agent-hub.json` exists.
- [ ] `agent-hub.json.entry` points to the correct HTML file.
- [ ] The entry HTML opens locally.
- [ ] All local assets referenced by the entry HTML exist.
- [ ] The app does not reference `localhost`, `127.0.0.1`, `file://`, or a personal machine path.
- [ ] No API keys, tokens, passwords, or private URLs are committed.
- [ ] The app does not depend on direct `window.top` control.
- [ ] `index.html` or `main.html` does not inline large data. Keep entry HTML below 5 MB.
- [ ] DB/data files are stored under `data/`, `db/`, or `datasets/` so `mx-agent-hub pack` can create a DB package when needed.
- [ ] `mx-agent-hub validate .` passes.
- [ ] `mx-agent-hub pack .` creates the upload ZIP.
