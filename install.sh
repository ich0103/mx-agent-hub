#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${MX_AGENT_HUB_REPO_URL:-https://github.com/company/mx-agent-hub.git}"
INSTALL_DIR="${MX_AGENT_HUB_INSTALL_DIR:-$HOME/.mx-agent-hub}"
BIN_DIR="${MX_AGENT_HUB_BIN_DIR:-$HOME/.local/bin}"

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "mx-agent-hub install error: $1 is required" >&2
    exit 1
  }
}

need git
need node

mkdir -p "$BIN_DIR"
rm -rf "$INSTALL_DIR"
git clone "$REPO_URL" "$INSTALL_DIR"

chmod +x "$INSTALL_DIR/src/cli.js"
ln -sf "$INSTALL_DIR/src/cli.js" "$BIN_DIR/mx-agent-hub"

echo "mx-agent-hub installed to $INSTALL_DIR"
echo "Binary linked at $BIN_DIR/mx-agent-hub"
echo "Run: mx-agent-hub init . --target codex"
