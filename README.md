# MX Agent Hub ADK

MX Agent Hub ADK installs a local registration harness and validates static HTML apps before they are uploaded to AX Agent Hub.

## Quick Start

```bash
mx-agent-hub init . --target codex
mx-agent-hub validate .
mx-agent-hub pack .
```

Targets:

- `codex`: installs `AGENTS.md`, `.codex/`, `.mx-agent-hub/`, and `agent-hub.json`
- `claude`: installs `CLAUDE.md`, `.claude/`, `.mx-agent-hub/`, and `agent-hub.json`
- `all`: installs both Codex and Claude instructions with the shared Hub harness

## Install From Git

During PoC, clone and link this repository.

```bash
git clone https://github.com/company/mx-agent-hub.git
cd mx-agent-hub
npm link
```

Or run directly from this checkout:

```bash
node src/cli.js init /path/to/project --target codex
node src/cli.js validate /path/to/project
node src/cli.js pack /path/to/project
```

## Commands

### init

```bash
mx-agent-hub init <projectDir> --target codex|claude|all
```

Installs the shared `.mx-agent-hub` harness and AI-tool-specific instruction files.

### validate

```bash
mx-agent-hub validate <projectDir>
mx-agent-hub validate <projectDir> --json
```

Checks whether the project can be registered in AX Agent Hub.

Exit codes:

- `0`: registerable
- `1`: blocking validation failures
- `2`: validator execution failure

### pack

```bash
mx-agent-hub pack <projectDir>
mx-agent-hub pack <projectDir> --out dist/agent-hub-package.zip
```

Runs validation and creates a Hub upload ZIP. Blocking failures stop packaging unless `--force` is provided.

## Current MVP Checks

- `agent-hub.json` parse and required fields
- entry HTML detection from manifest, `index.html`, or first `.html`
- local CSS/JS/image asset reference resolution
- secret-like string detection
- `localhost`, `127.0.0.1`, `file://`, and local absolute path detection
- iframe sandbox risk patterns such as `window.top` and `top.location`
- ZIP packaging through the system `zip` command
