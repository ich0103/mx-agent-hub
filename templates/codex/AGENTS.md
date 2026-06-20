# AX Agent Hub Instructions

Before changing this project for AX Agent Hub registration:

1. Read `.mx-agent-hub/rules.md`.
2. Keep `agent-hub.json` aligned with the actual entry HTML.
3. Run `mx-agent-hub validate .` before packaging.
4. Fix all `FAIL` items before running `mx-agent-hub pack .`.
5. Do not auto-fix authentication, backend API contracts, secrets, or business logic without explicit human review.

For Hub packaging, use:

```bash
mx-agent-hub validate .
mx-agent-hub pack .
```
