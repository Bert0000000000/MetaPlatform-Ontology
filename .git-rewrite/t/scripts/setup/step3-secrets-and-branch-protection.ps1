# scripts/setup/step3-secrets-and-branch-protection.ps1
# START.md Step 3:
#   1. Configure GitHub Secrets
#   2. Enable main branch protection (8 required checks)
#   3. Configure repo merge settings (squash only, delete branch on merge)
# ASCII-only to avoid PowerShell 5 encoding issues on Windows.
#
# Secrets that already exist are skipped. Secrets with empty input are skipped.
# Re-running this script is safe and idempotent.

$ErrorActionPreference = 'Stop'

$Org          = 'Bert0000000000'
$Repo         = 'MetaPlatform-Ontology'
$FullName     = "$Org/$Repo"
$Branch       = 'main'

function Step($n, $msg) { Write-Host ("[{0}] {1}" -f $n, $msg) -ForegroundColor Cyan }
function Ok($msg)        { Write-Host ("  OK  " + $msg) -ForegroundColor Green }
function Warn($msg)      { Write-Host ("  WARN " + $msg) -ForegroundColor Yellow }
function Err($msg)       { Write-Host ("  ERR  " + $msg) -ForegroundColor Red }

# --- 0. Tool + auth -------------------------------------------------------
Step 0 'Checking gh auth'
foreach ($tool in @('gh')) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        Err "$tool not found in PATH"; exit 1
    }
}
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

# --- 1. Repo settings (squash only, delete branch on merge) --------------
Step 1 'Configuring repo merge settings (squash only, delete-branch-on-merge)'

$repoPayload = @{
    allow_squash_merge    = $true
    allow_merge_commit    = $false
    allow_rebase_merge    = $false
    delete_branch_on_merge = $true
} | ConvertTo-Json

gh api "repos/$FullName" -X PATCH --input $repoPayload *> $null
if ($LASTEXITCODE -ne 0) {
    Err 'failed to update repo merge settings'; exit 1
}
Ok 'squash-only + delete-branch-on-merge enabled'

# --- 2. Branch protection -------------------------------------------------
Step 2 'Configuring main branch protection (8 required checks + 1 PR review)'

# IMPORTANT: contexts must match the EXACT job names produced by ci.yml.
# These names correspond to the workflow names / job names in
# docs/active/workflows/ci.yml.
$protectionPayload = @{
    required_status_checks = @{
        strict   = $true
        contexts = @(
            'Lint'
            'Typecheck'
            'Test'
            'Build'
            'Evidence Document Check'
            'Secret Scan'
            'Helm + NetworkPolicy Validate'
            'RLS Policy Check'
        )
    }
    enforce_admins = $true
    required_pull_request_reviews = @{
        required_approving_review_count = 1
        dismiss_stale_reviews           = $true
    }
    required_linear_history = $true
    allow_force_pushes      = $false
    allow_deletions         = $false
} | ConvertTo-Json -Depth 10

gh api "repos/$FullName/branches/$Branch/protection" --input $protectionPayload *> $null
if ($LASTEXITCODE -ne 0) {
    Err 'failed to set branch protection'
    Warn 'Note: the 8 context names above must match ci.yml job names exactly'
    exit 1
}
Ok 'main branch protection enabled'

# --- 3. GitHub Secrets ----------------------------------------------------
Step 3 'Configuring GitHub Secrets'
Warn 'For each secret: press Enter to skip, or paste the value.'
Warn 'Skipping is safe — you can re-run this script later to set missing ones.'

$secrets = @(
    @{ Name = 'ANTHROPIC_API_KEY';  Prompt = 'Anthropic API key (Claude Code)' },
    @{ Name = 'HARBOR_USERNAME';    Prompt = 'Harbor username (image registry)' },
    @{ Name = 'HARBOR_PASSWORD';    Prompt = 'Harbor password / token' },
    @{ Name = 'ARGOCD_SERVER';      Prompt = 'ArgoCD server URL (e.g. https://argocd.example.com)' },
    @{ Name = 'ARGOCD_USERNAME';    Prompt = 'ArgoCD username' },
    @{ Name = 'ARGOCD_PASSWORD';    Prompt = 'ArgoCD password' },
    @{ Name = 'SLACK_WEBHOOK_PROD'; Prompt = 'Slack incoming webhook URL (prod alerts)' }
)

$skipped = @()
$set     = @()

foreach ($s in $secrets) {
    $val = Read-Host ("  {0} ({1})" -f $s.Name, $s.Prompt)
    if ([string]::IsNullOrWhiteSpace($val)) {
        $skipped += $s.Name
        Warn ("skipped: " + $s.Name)
        continue
    }
    $val | gh secret set $s.Name --repo $FullName
    if ($LASTEXITCODE -ne 0) {
        Err ("failed to set " + $s.Name); exit 1
    }
    $set += $s.Name
    Ok ("set: " + $s.Name)
}

# --- 4. Summary -----------------------------------------------------------
Write-Host ''
Write-Host '========================================' -ForegroundColor Green
Write-Host '  Step 3 done' -ForegroundColor Green
Write-Host '========================================' -ForegroundColor Green
Write-Host ('  Secrets set (' + $set.Count + '): ' + ($set -join ', '))
if ($skipped.Count -gt 0) {
    Write-Host ('  Secrets skipped (' + $skipped.Count + '): ' + ($skipped -join ', ')) -ForegroundColor Yellow
    Write-Host '  Re-run this script later to set the skipped ones.' -ForegroundColor Yellow
}
Write-Host ''
Write-Host 'Verify at:' -ForegroundColor Cyan
Write-Host "  https://github.com/$FullName/settings/secrets/actions"
Write-Host "  https://github.com/$FullName/settings/branches"
Write-Host "  https://github.com/$FullName/settings#merge-button-settings"