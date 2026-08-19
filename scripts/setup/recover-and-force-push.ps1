# scripts/setup/recover-and-force-push.ps1
# Recovery for the case where the previous push was blocked by GitHub's
# auto-generated "Initial commit" (placeholder README), leaving conflict
# markers in local files and an unrelated-history state.
#
# Strategy:
#   1. Abort any in-progress rebase / merge.
#   2. Remove conflict markers from tracked files (we always keep the local
#      side; the remote only had GitHub's auto-generated placeholder).
#   3. Commit any leftover conflict-marker fixes.
#   4. Force-push to origin main (safe: remote only had a placeholder README).
# ASCII-only to avoid PowerShell 5 encoding issues on Windows.

$ErrorActionPreference = 'Stop'

$RepoPath  = 'D:\Hermes\Workspace\10_Projects\MetaPlatform-Ontology'
$RemoteUrl = 'https://github.com/Bert0000000000/MetaPlatform-Ontology.git'
$Branch    = 'main'

Set-Location -LiteralPath $RepoPath

function Step($n, $msg) { Write-Host ("[{0}] {1}" -f $n, $msg) -ForegroundColor Cyan }
function Ok($msg)        { Write-Host ("  OK  " + $msg) -ForegroundColor Green }
function Warn($msg)      { Write-Host ("  WARN " + $msg) -ForegroundColor Yellow }
function Err($msg)       { Write-Host ("  ERR  " + $msg) -ForegroundColor Red }

# --- 1. Abort any in-progress rebase/merge -------------------------------
Step 1 'Abort any in-progress rebase / merge'

$prev = $ErrorActionPreference
$ErrorActionPreference = 'SilentlyContinue'

if (Test-Path '.git\rebase-merge')     { git rebase --abort | Out-Null; Ok 'rebase-merge aborted' }
elseif (Test-Path '.git\rebase-apply') { git rebase --abort | Out-Null; Ok 'rebase-apply aborted' }
else { Warn 'no rebase in progress' }

if (Test-Path '.git\MERGE_HEAD')       { git merge --abort  | Out-Null; Ok 'merge aborted' }

$ErrorActionPreference = $prev

# --- 2. Strip conflict markers from all tracked files -------------------
Step 2 'Strip conflict markers (keep local content)'

$files = @()
$ErrorActionPreference = 'SilentlyContinue'
try { $files = git diff --name-only --diff-filter=U } catch {}
$ErrorActionPreference = $prev

if (-not $files -or $files.Count -eq 0) {
    # Fall back to grepping the whole tree for conflict markers.
    $grep = git grep -l -E '^(<{7}|={7}|>{7})( |$)' . 2>$null
    if ($grep) { $files = $grep }
}

if (-not $files -or $files.Count -eq 0) {
    Warn 'no files with conflict markers found'
} else {
    foreach ($f in $files) {
        if (-not (Test-Path $f)) { continue }
        $lines = Get-Content -LiteralPath $f -Encoding UTF8
        $out = New-Object System.Collections.Generic.List[string]
        $inConflict = $false
        $keepSide = ''   # 'ours' = keep lines before =======, 'theirs' = after; we pick 'ours'
        foreach ($line in $lines) {
            if ($line -match '^<<<<<<< ') {
                $inConflict = $true
                $keepSide = 'ours'
                continue
            }
            if ($inConflict -and $line -match '^=======$') {
                $keepSide = 'theirs'
                continue
            }
            if ($inConflict -and $line -match '^>>>>>>> ') {
                $inConflict = $false
                $keepSide = ''
                continue
            }
            if ($inConflict) {
                if ($keepSide -eq 'ours') { $out.Add($line) }
                continue
            }
            $out.Add($line)
        }
        Set-Content -LiteralPath $f -Value $out -Encoding UTF8
        Ok ("cleaned: " + $f)
    }
}

# --- 3. Stage + commit fixes if any --------------------------------------
Step 3 'Stage and commit any remaining conflict-marker fixes'

git add -A
$diff = git diff --cached --shortstat
if ($diff) {
    git commit -m 'fix: remove rebase conflict markers (keep local content)'
    Ok 'commit created'
} else {
    Warn 'nothing to commit'
}

# --- 4. Show pre-push state ----------------------------------------------
Step 4 'Pre-push state'
git status --short
git log --oneline -5

# --- 5. Confirm ----------------------------------------------------------
Write-Host ''
$confirm = Read-Host ("About to FORCE-PUSH to $RemoteUrl ($Branch). Remote currently only has GitHub's auto-generated placeholder. Proceed? (yes/no)")
if ($confirm -ne 'yes') { Warn 'aborted by user'; exit 1 }

# --- 6. Force push -------------------------------------------------------
Step 6 ('git push --force-with-lease origin {0}' -f $Branch)
$prev = $ErrorActionPreference
$ErrorActionPreference = 'SilentlyContinue'
git push --force-with-lease origin $Branch
$pushCode = $LASTEXITCODE
$ErrorActionPreference = $prev
if ($pushCode -ne 0) {
    Err 'force push failed'
    exit 1
}

Write-Host ''
Write-Host '========================================' -ForegroundColor Green
Write-Host '  Done!' -ForegroundColor Green
Write-Host '  https://github.com/Bert0000000000/MetaPlatform-Ontology' -ForegroundColor Cyan
Write-Host '========================================' -ForegroundColor Green
