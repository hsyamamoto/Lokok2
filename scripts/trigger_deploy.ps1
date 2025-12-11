Param(
  [Parameter(Mandatory=$false)][string]$Owner,
  [Parameter(Mandatory=$false)][string]$Repo,
  [Parameter(Mandatory=$false)][string]$Ref = "main",
  [Parameter(Mandatory=$false)][string]$ExcelPath = "",
  [Parameter(Mandatory=$false)][string]$ExcelDownloadUrl = "",
  [Parameter(Mandatory=$false)][string]$ForceLocalExcel = "",
  [Parameter(Mandatory=$false)][string]$TokenEnvName = "GITHUB_TOKEN",
  [Parameter(Mandatory=$false)][string]$WorkflowFile = "deploy-railway-v2.yml"
)

function Get-GitHubRepoFromRemote {
  try {
    $remote = git remote get-url origin 2>$null
    if (-not $remote) { return $null }
    # Handle HTTPS: https://github.com/owner/repo.git
    if ($remote -match 'https?://github.com/([^/]+)/([^\.]+)') {
      return @{ Owner = $Matches[1]; Repo = $Matches[2] }
    }
    # Handle SSH: git@github.com:owner/repo.git
    if ($remote -match 'git@github.com:([^/]+)/([^\.]+)') {
      return @{ Owner = $Matches[1]; Repo = $Matches[2] }
    }
    return $null
  } catch { return $null }
}

# Resolve owner/repo if not provided
$repoInfo = $null
if (-not $Owner -or -not $Repo) {
  $repoInfo = Get-GitHubRepoFromRemote
  if ($repoInfo) {
    if (-not $Owner) { $Owner = $repoInfo.Owner }
    if (-not $Repo) { $Repo = $repoInfo.Repo }
  }
}
if (-not $Owner -or -not $Repo) {
  Write-Error "Não foi possível determinar Owner/Repo. Informe -Owner e -Repo, ou configure o remote 'origin'."
  exit 1
}

# Resolve token from environment
$token = [Environment]::GetEnvironmentVariable($TokenEnvName)
if (-not $token) {
  # fallbacks
  $token = [Environment]::GetEnvironmentVariable('GH_TOKEN')
}
if (-not $token) {
  Write-Error "Token do GitHub não encontrado. Defina $TokenEnvName ou GH_TOKEN no ambiente."
  exit 1
}

if (-not $WorkflowFile) { $WorkflowFile = "deploy-railway-v2.yml" }
$uri = "https://api.github.com/repos/$Owner/$Repo/actions/workflows/$WorkflowFile/dispatches"

$inputs = @{}
if ($ExcelPath) { $inputs.EXCEL_PATH = $ExcelPath }
if ($ExcelDownloadUrl) { $inputs.EXCEL_DOWNLOAD_URL = $ExcelDownloadUrl }
if ($ForceLocalExcel) { $inputs.FORCE_LOCAL_EXCEL = $ForceLocalExcel }

$body = @{ ref = $Ref; inputs = $inputs } | ConvertTo-Json -Depth 5

$headers = @{ Authorization = "Bearer $token"; Accept = "application/vnd.github+json" }

Write-Host "Disparando workflow '$WorkflowFile' em $Owner/$Repo (ref=$Ref)..."
try {
  $resp = Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -Body $body
  Write-Host "Workflow dispatch enviado com sucesso. Verifique o GitHub Actions para progresso."
} catch {
  Write-Error "Falha ao disparar workflow: $($_.Exception.Message)"
  if ($_.ErrorDetails.Message) { Write-Error $_.ErrorDetails.Message }
  exit 1
}
