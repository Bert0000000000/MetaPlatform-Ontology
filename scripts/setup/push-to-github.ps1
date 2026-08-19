# scripts/setup/push-to-github.ps1
# Push local MetaPlatform-Ontology to GitHub: Bert0000000000/MetaPlatform-Ontology
# Uses HTTPS (relies on gh auth for git credential helper).
# ASCII-only to avoid PowerShell 5 encoding issues on Windows.

$ErrorActionPreference = 'Stop'

$RepoPath  = 'D:\Hermes\Workspace\10_Projects\MetaPlatform-Ontology'
$RemoteUrl = 'https://github.com/Bert0000000000/MetaPlatform-Ontology.git'
$Branch    = 'main'
$CommitMsg = 'feat: initial v6.0 documentation + CI/CD + workflow templates'

Set-Location -LiteralPath $RepoPath

function Step($n, $msg) { Write-Host ("[{0}] {1}" -f $n, $msg) -ForegroundColor Cyan }
function Ok($msg)        { Write-Host ("  OK  " + $msg) -ForegroundColor Green }
function Warn($msg)      { Write-Host ("  WARN " + $msg) -ForegroundColor Yellow }
function Err($msg)       { Write-Host ("  ERR  " + $msg) -ForegroundColor Red }

# --- 1. Tool checks -------------------------------------------------------
Step 1 'Checking required tools: git, gh'
foreach ($tool in @('git', 'gh')) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        Err "$tool not found in PATH"
        exit 1
    }
}
Ok 'git and gh are available'

# --- 2. gh auth -----------------------------------------------------------
Step 2 'Checking gh auth status'
$authOk = $true
gh auth status *> $null
if ($LASTEXITCODE -ne 0) { $authOk = $false }
if (-not $authOk) {
    Warn 'gh is not logged in.'
    $ans = Read-Host 'Run `gh auth login --web --git-protocol https` now? (yes/no)'
    if ($ans -eq 'yes') {
        gh auth login --web --git-protocol https
        if ($LASTEXITCODE -ne 0) { Err 'gh login failed'; exit 1 }
    } else {
        Err 'gh auth is required'; exit 1
    }
}
Ok 'gh is authenticated'

# Wire gh as the git credential helper so push does not prompt for a token.
gh auth setup-git *> $null
Ok 'git credential helper is wired to gh'

# --- 3. Git identity ------------------------------------------------------
Step 3 'Checking git identity'
if (-not (git config --global user.name)) {
    git config --global user.name 'Bert0000000000'
    Ok 'set git user.name = Bert0000000000'
}
if (-not (git config --global user.email)) {
    git config --global user.email 'Bert0000000000@users.noreply.github.com'
    Ok 'set git user.email'
}

# --- 4. git init ----------------------------------------------------------
Step 4 'Ensuring local git repo on branch main'
if (-not (Test-Path '.git')) {
    git init -b $Branch | Out-Null
    Ok 'git init -b main'
} else {
    Warn '.git already exists, skipping init'
    $current = git rev-parse --abbrev-ref HEAD
    if ($current -ne $Branch) {
        git checkout -B $Branch | Out-Null
        Ok "switched/created branch $Branch"
    }
}

# --- 5. Remote ------------------------------------------------------------
Step 5 'Configuring origin'
$existing = $null
$prevPref = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
    $existing = git remote get-url origin 2>$null
} catch {
    $existing = $null
} finally {
    $ErrorActionPreference = $prevPref
}
if ($existing -eq $RemoteUrl) {
    Warn 'origin already points to target repo'
} elseif ($existing) {
    Warn "origin currently points to: $existing"
    $ans = Read-Host 'Overwrite origin with the target URL? (yes/no)'
    if ($ans -eq 'yes') {
        git remote remove origin
        git remote add origin $RemoteUrl
        Ok 'origin updated'
    } else {
        Err 'aborted by user'; exit 1
    }
} else {
    git remote add origin $RemoteUrl
    Ok 'origin added'
}

# --- 6. Status preview ----------------------------------------------------
Step 6 'git status preview'
git status --short

# --- 7. Confirm -----------------------------------------------------------
Write-Host ''
$confirm = Read-Host ("About to run: git add . ; git commit ; git push -u origin {0}. Proceed? (yes/no)" -f $Branch)
if ($confirm -ne 'yes') {
    Warn 'aborted by user'; exit 1
}

# --- 8. Add + commit ------------------------------------------------------
Step 8 'git add + commit'
git add .
git commit -m $CommitMsg
if ($LASTEXITCODE -ne 0) {
    Err 'git commit failed'; exit 1
}
Ok 'commit created'

# --- 9. Push --------------------------------------------------------------
Step 9 ('git push -u origin {0}' -f $Branch)
git push -u origin $Branch
if ($LASTEXITCODE -ne 0) {
    Err 'git push failed'; exit 1
}

Write-Host ''
Write-Host '========================================' -ForegroundColor Green
Write-Host '  Done!' -ForegroundColor Green
Write-Host '  https://github.com/Bert0000000000/MetaPlatform-Ontology' -ForegroundColor Cyan
Write-Host '========================================' -ForegroundColor Green
