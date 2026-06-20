#!/usr/bin/env bash
set -euo pipefail

GITHUB_REPOSITORY="${MX_AGENT_HUB_GITHUB_REPOSITORY:-company/mx-agent-hub}"
REPO_BRANCH="${MX_AGENT_HUB_REPO_BRANCH:-main}"
REPO_URL="${MX_AGENT_HUB_REPO_URL:-https://github.com/${GITHUB_REPOSITORY}.git}"
INSTALL_DIR="${MX_AGENT_HUB_INSTALL_DIR:-$HOME/.mx-agent-hub}"
BIN_DIR="${MX_AGENT_HUB_BIN_DIR:-$HOME/.local/bin}"

info() {
  echo "mx-agent-hub install: $*"
}

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "mx-agent-hub install error: $1 is required" >&2
    exit 1
  }
}

detect_platform() {
  local kernel
  kernel="$(uname -s)"

  case "$kernel" in
    Darwin)
      echo "macos"
      ;;
    Linux)
      if grep -qi microsoft /proc/version 2>/dev/null; then
        echo "wsl"
      else
        echo "linux"
      fi
      ;;
    *)
      echo "unknown"
      ;;
  esac
}

append_path_hint() {
  if command -v mx-agent-hub >/dev/null 2>&1; then
    return
  fi

  cat <<EOF

mx-agent-hub was installed, but $BIN_DIR is not currently on PATH.
Add this to your shell profile:

  export PATH="$BIN_DIR:\$PATH"

Then restart your shell or run:

  export PATH="$BIN_DIR:\$PATH"
EOF
}

PLATFORM="$(detect_platform)"

info "platform detected: $PLATFORM"
need git
need node

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "mx-agent-hub install error: Node.js 18 or newer is required" >&2
  exit 1
fi

mkdir -p "$BIN_DIR"
rm -rf "$INSTALL_DIR"
git clone --branch "$REPO_BRANCH" --depth 1 "$REPO_URL" "$INSTALL_DIR"

chmod +x "$INSTALL_DIR/src/cli.js"
ln -sf "$INSTALL_DIR/src/cli.js" "$BIN_DIR/mx-agent-hub"

info "installed to $INSTALL_DIR"
info "binary linked at $BIN_DIR/mx-agent-hub"
append_path_hint

cat <<EOF

Run:
  mx-agent-hub init . --target codex
  mx-agent-hub validate .
  mx-agent-hub pack .
EOF
