# AX Agent Hub Registration Rules

## Required

- The project must include `agent-hub.json`.
- `agent-hub.json.entry` must point to the HTML file that AX Hub should render.
- The entry HTML must exist.
- Referenced local CSS, JavaScript, image, font, and media assets must exist.
- The app must not contain secret-like values such as API keys, tokens, passwords, or private keys.
- The app must not rely on `localhost`, `127.0.0.1`, `file://`, or developer machine paths.
- The app must run inside an iframe sandbox.

## Recommended

- Keep the app static and self-contained.
- Prefer relative asset paths.
- Use `postMessage` for Hub communication instead of accessing `window.top`.
- Keep the first screen non-empty.
- Provide loading, empty, and error states for user-facing flows.
- Test desktop and mobile widths before packaging.

## Do Not Auto-Fix

Do not automatically change authentication, backend API contracts, secret handling, or business logic. The validator may suggest fixes, but these changes require human review.
