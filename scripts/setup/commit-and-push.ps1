# scripts/setup/commit-and-push.ps1
# Quick commit + push helper. Stages everything modified and pushes with a
# message supplied on the command line, or via -Message.
# Usage:
#   .\scripts\setup\commit-and-push.ps1 -Message "docs: rewrite README and add project context to CLAUDE.md"
# ASCII-only to avoid PowerShell 5 encoding issues on Windows.

param(
    [Parameter(Mandatory = $false, Position = 0)]
    [string]$Message = 'docs: update README and CLAUDE.md'
)

$ErrorActionPreference = 'Stop'

$RepoPath  = 'D:\Hermes\Workspace\10_Projects\MetaPlatform-Ontology'
$RemoteUrl = 'https://github.com/Bert0000000000/MetaPlatform-Ontology.git'
$Branch    = 'main'

Set-Location -LiteralPath $RepoPath

function Step($n, $msg) { Write-Host ("[{0}] {1}" -f $n, $msg) -ForegroundColor Cyan }
function Ok($msg)        { Write-Host ("  OK  " + $msg) -ForegroundColor Green }
function Warn($msg)      { Write-Host ("  WARN " + $msg) -ForegroundColor Yellow }
function Err($msg)       { Write-Host ("  ERR  " + $msg) -ForegroundColor Red }

# --- 1. gh auth ---------------------------------------------------------
Step 1 'Verifying gh auth'
$prev = $ErrorActionPreference
$ErrorActionPreference = 'SilentlyContinue'
gh auth status 2>&1 | Out-Null
$authOk = ($LASTEXITCODE -eq 0)
$ErrorActionPreference = $prev
if (-not $authOk) {
    Err 'gh is not authenticated. Run: gh auth login --web --git-protocol https'
    exit 1
}
Ok 'gh is authenticated'

# --- 2. Status preview --------------------------------------------------
Step 2 'Status preview'
git status --short

# --- 3. Stage -----------------------------------------------------------
Step 3 'git add -A'
git add -A
git status --short

# --- 4. Commit ----------------------------------------------------------
Step 4 'git commit'
$diff = git diff --cached --shortstat
if (-not $diff) {
    Warn 'nothing to commit (working tree clean)'
    exit 0
}
git commit -m $Message
if ($LASTEXITCODE -ne 0) {
    Err 'commit failed'; exit 1
}
Ok 'commit created'

# --- 5. Push ------------------------------------------------------------
Step 5 ('git push origin {0}' -f $Branch)
$prev = $ErrorActionPreference
$ErrorActionPreference = 'SilentlyContinue'
git push origin $Branch
$pushCode = $LASTEXITCODE
$ErrorActionPreference = $prev
if ($pushCode -ne 0) {
    Err 'push failed'; exit 1
}

Write-Host ''
Write-Host '========================================' -ForegroundColor Green
Write-Host '  Pushed to GitHub' -ForegroundColor Green
Write-Host ('  https://github.com/Bert0000000000/MetaPlatform-Ontology/commit/' + (git rev-parse HEAD)) -ForegroundColor Cyan
Write-Host '========================================' -ForegroundColor Green