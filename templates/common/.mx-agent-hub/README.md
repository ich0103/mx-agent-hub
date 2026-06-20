# AX Agent Hub Harness

This directory contains the local registration harness for AX Agent Hub.

Use it before uploading an app to the Hub.

```bash
mx-agent-hub validate .
mx-agent-hub pack .
```

Core files:

- `rules.md`: registration rules for humans and AI coding agents
- `registration-checklist.md`: pre-upload checklist
- `schema/agent-hub.schema.json`: manifest schema
- `scripts/validate.mjs`: local validation wrapper
- `scripts/pack.mjs`: local packaging wrapper
- `reports/`: generated validation reports
