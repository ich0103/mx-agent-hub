# AX Agent Hub Registration Checklist

- [ ] `agent-hub.json` exists.
- [ ] `agent-hub.json.entry` points to the correct HTML file.
- [ ] The entry HTML opens locally.
- [ ] All local assets referenced by the entry HTML exist.
- [ ] The app does not reference `localhost`, `127.0.0.1`, `file://`, or a personal machine path.
- [ ] No API keys, tokens, passwords, or private URLs are committed.
- [ ] The app does not depend on direct `window.top` control.
- [ ] `mx-agent-hub validate .` passes.
- [ ] `mx-agent-hub pack .` creates the upload ZIP.
