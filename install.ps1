$ErrorActionPreference = "Stop"

$GithubRepository = if ($env:MX_AGENT_HUB_GITHUB_REPOSITORY) { $env:MX_AGENT_HUB_GITHUB_REPOSITORY } else { "company/mx-agent-hub" }
$RepoBranch = if ($env:MX_AGENT_HUB_REPO_BRANCH) { $env:MX_AGENT_HUB_REPO_BRANCH } else { "main" }
$RepoUrl = if ($env:MX_AGENT_HUB_REPO_URL) { $env:MX_AGENT_HUB_REPO_URL } else { "https://github.com/$GithubRepository.git" }
$InstallDir = if ($env:MX_AGENT_HUB_INSTALL_DIR) { $env:MX_AGENT_HUB_INSTALL_DIR } else { Join-Path $HOME ".mx-agent-hub" }
$BinDir = if ($env:MX_AGENT_HUB_BIN_DIR) { $env:MX_AGENT_HUB_BIN_DIR } else { Join-Path $HOME ".local\bin" }

function Require-Command {
  param([string]$Name)

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "mx-agent-hub install error: $Name is required"
  }
}

Write-Host "mx-agent-hub install: platform detected: windows"
Require-Command git
Require-Command node

$NodeMajor = [int](& node -p "process.versions.node.split('.')[0]")
if ($NodeMajor -lt 18) {
  throw "mx-agent-hub install error: Node.js 18 or newer is required"
}

New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

if (Test-Path $InstallDir) {
  Remove-Item -Recurse -Force $InstallDir
}

git clone --branch $RepoBranch --depth 1 $RepoUrl $InstallDir

$CmdPath = Join-Path $BinDir "mx-agent-hub.cmd"
$CliPath = Join-Path $InstallDir "src\cli.js"

@"
@echo off
node "$CliPath" %*
"@ | Set-Content -Encoding ASCII $CmdPath

$CurrentUserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (-not ($CurrentUserPath -split ";" | Where-Object { $_ -eq $BinDir })) {
  [Environment]::SetEnvironmentVariable("Path", "$CurrentUserPath;$BinDir", "User")
  Write-Host ""
  Write-Host "mx-agent-hub install: added $BinDir to the user PATH."
  Write-Host "Restart PowerShell before using mx-agent-hub from a new terminal."
}

Write-Host ""
Write-Host "mx-agent-hub installed to $InstallDir"
Write-Host "Binary linked at $CmdPath"
Write-Host ""
Write-Host "Run:"
Write-Host "  mx-agent-hub init . --target codex"
Write-Host "  mx-agent-hub validate ."
Write-Host "  mx-agent-hub pack ."
