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

## Usage

### 1. Install the CLI during PoC

GitHub repository: `ich0103/mx-agent-hub`

Prerequisites:

- Git
- Node.js 18 or newer

#### macOS

```bash
curl -fsSL https://raw.githubusercontent.com/ich0103/mx-agent-hub/main/install.sh | bash
```

#### Ubuntu

```bash
curl -fsSL https://raw.githubusercontent.com/ich0103/mx-agent-hub/main/install.sh | bash
```

#### WSL

Use the same Linux installer inside the WSL shell.

```bash
curl -fsSL https://raw.githubusercontent.com/ich0103/mx-agent-hub/main/install.sh | bash
```

If `~/.local/bin` is not on `PATH`, add this to `~/.bashrc` or `~/.zshrc`.

```bash
export PATH="$HOME/.local/bin:$PATH"
```

#### Windows PowerShell

Run PowerShell as a normal user.

```powershell
iwr -useb https://raw.githubusercontent.com/ich0103/mx-agent-hub/main/install.ps1 | iex
```

If PowerShell blocks script execution, use:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
iwr -useb https://raw.githubusercontent.com/ich0103/mx-agent-hub/main/install.ps1 | iex
```

#### Safer install

For any OS, prefer reviewing the installer before running it.

macOS, Ubuntu, WSL:

```bash
curl -fsSL https://raw.githubusercontent.com/ich0103/mx-agent-hub/main/install.sh -o install.sh
cat install.sh
bash install.sh
```

Windows PowerShell:

```powershell
iwr -useb https://raw.githubusercontent.com/ich0103/mx-agent-hub/main/install.ps1 -OutFile install.ps1
Get-Content install.ps1
.\install.ps1
```

#### Local development install

From this ADK repository:

```bash
cd /Users/mae/mx-agent-hub
npm link
```

Confirm that the command is available:

```bash
mx-agent-hub --help
```

You can also run without linking:

```bash
node /Users/mae/mx-agent-hub/src/cli.js --help
```

### 2. Add the Hub harness to an app project

Go to the project that contains the HTML app you want to register.

```bash
cd /path/to/my-agent-app
mx-agent-hub init . --target codex
```

For Claude projects:

```bash
mx-agent-hub init . --target claude
```

For both Codex and Claude:

```bash
mx-agent-hub init . --target all
```

After `init`, the project contains:

```text
agent-hub.json
.mx-agent-hub/
AGENTS.md or CLAUDE.md
.codex/ or .claude/
```

### 3. Point the manifest to your HTML entry

Edit `agent-hub.json`.

```json
{
  "schemaVersion": 1,
  "name": "My Agent App",
  "description": "Short description for AX Agent Hub.",
  "version": "0.1.0",
  "entry": "app/index.html",
  "runtime": "static-html"
}
```

The `entry` value should point to the HTML file that AX Hub should render.

Entry detection order:

1. `agent-hub.json.entry`
2. `index.html`
3. first `.html` file found in the project

### 4. Validate before uploading

```bash
mx-agent-hub validate .
```

Example successful result:

```text
Result
  Registerable
  PASS 5 / WARN 0 / FAIL 0
```

Example failed result:

```text
Security
  FAIL local-only reference found (app/index.html:18)
       http://localhost:3000/api

Result
  Not registerable
```

Fix every `FAIL` item before uploading to AX Hub. `WARN` items do not block packaging, but should be reviewed.

For machine-readable output:

```bash
mx-agent-hub validate . --json
```

### 5. Create the Hub upload package

```bash
mx-agent-hub pack .
```

Default output:

```text
dist/agent-hub-package.zip
```

Custom output:

```bash
mx-agent-hub pack . --out dist/my-agent.zip
```

The `pack` command runs validation first. If validation has `FAIL` items, packaging stops.

### 6. Upload to AX Hub

Use the generated ZIP in the AX Hub `/app` registration screen.

Recommended registration flow:

1. Fill in agent name, category, owner, organization, visibility, and description.
2. Upload the ZIP created by `mx-agent-hub pack`.
3. Confirm that the preview opens.
4. Register the app.

## Common Workflows

### Existing static site

```bash
cd my-static-site
mx-agent-hub init . --target codex
vim agent-hub.json
mx-agent-hub validate .
mx-agent-hub pack .
```

### Single HTML file

```bash
mkdir my-agent-app
cp ~/Downloads/report.html my-agent-app/index.html
cd my-agent-app
mx-agent-hub init . --target codex
mx-agent-hub validate .
mx-agent-hub pack .
```

### Build output folder

```bash
npm run build
cd dist
mx-agent-hub init . --target codex
mx-agent-hub validate .
mx-agent-hub pack .
```

If your build output uses `main.html` or another entry file, update `agent-hub.json`.

## Install From Git

During PoC, clone and link this repository.

```bash
git clone https://github.com/ich0103/mx-agent-hub.git
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
