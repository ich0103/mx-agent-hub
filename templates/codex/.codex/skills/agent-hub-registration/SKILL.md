---
name: agent-hub-registration
description: Use when preparing a static HTML app for AX Agent Hub registration, validating Hub manifest rules, or packaging the app for upload.
---

# Agent Hub Registration

Before making registration-related changes:

1. Read `.mx-agent-hub/rules.md`.
2. Inspect `agent-hub.json`.
3. Verify that the manifest `entry` file exists.
4. Run `mx-agent-hub validate .`.

Fix all blocking `FAIL` items before packaging.

Do not automatically rewrite authentication, API contracts, secret handling, or business logic. Provide a recommendation instead.
