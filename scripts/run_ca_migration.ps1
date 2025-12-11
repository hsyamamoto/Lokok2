Param(
  [string]$DatabaseUrl,
  [switch]$Apply,
  [switch]$ForceCreatedBy
)

function Ensure-SslModeRequired([string]$url) {
  if (-not $url) { return $url }
  if ($url -match 'sslmode=') { return $url }
  if ($url -match '\?') { return "$url&sslmode=require" } else { return "$url?sslmode=require" }
}

function Is-ValidPgUrl([string]$url) {
  if (-not $url) { return $false }
  # Deve começar com postgres:// ou postgresql://
  if ($url -notmatch '^(postgres|postgresql)://') { return $false }
  return $true
}

function Is-RailwayInternalHost([string]$url) {
  if (-not $url) { return $false }
  try {
    $uri = [System.Uri]$url
    $host = $uri.Host
    if ($host -eq 'postgres.railway.internal') { return $true }
    if ($host -like '*.railway.internal') { return $true }
    return $false
  } catch {
    return $false
  }
}

function Prompt-DatabaseUrl([string]$current) {
  if (Is-ValidPgUrl $current) {
    if (Is-RailwayInternalHost $current) {
      Write-Warning "Host interno do Railway ('*.railway.internal') não é acessível a partir da sua máquina local."
      Write-Host "Use a DATABASE_PUBLIC_URL (host proxy.rlwy.net) ou crie um túnel local com 'railway connect' (host localhost)." -ForegroundColor Yellow
    } else {
      return $current
    }
  }
  Write-Warning "DATABASE_URL inválido ou ausente. Não use URL HTTP da aplicação."
  Write-Host "Cole a URL do Postgres do Railway no formato: postgresql://usuario:senha@host:port/dbname" -ForegroundColor Yellow
  $entered = Read-Host "DATABASE_URL (Postgres)"
  if (-not (Is-ValidPgUrl $entered)) {
    Write-Error "Formato inválido. Deve começar com 'postgresql://'."
    return (Prompt-DatabaseUrl $null)
  }
  if (Is-RailwayInternalHost $entered) {
    Write-Error "Host interno do Railway detectado. Use a URL pública (proxy.rlwy.net) ou um túnel local (localhost)."
    return (Prompt-DatabaseUrl $null)
  }
  return $entered
}

# Descobrir diretório raiz do projeto (um nível acima de scripts)
$rootDir = (Resolve-Path "$PSScriptRoot\..").Path
$envProdPath = Join-Path $rootDir ".env.production"

# Carregar DATABASE_URL de .env.production se não foi passado por parâmetro
if (-not $DatabaseUrl -and (Test-Path $envProdPath)) {
  $lines = Get-Content -Path $envProdPath
  foreach ($line in $lines) {
    if ($line -match '^\s*#') { continue }
    if ($line -match '^\s*DATABASE_URL\s*=\s*(.+)\s*$') {
      $DatabaseUrl = $Matches[1].Trim().Trim('"')
      break
    }
  }
}

if (-not (Is-ValidPgUrl $DatabaseUrl)) {
  $DatabaseUrl = Prompt-DatabaseUrl $DatabaseUrl
}

if (Is-RailwayInternalHost $DatabaseUrl) {
  $DatabaseUrl = Prompt-DatabaseUrl $null
}

$DatabaseUrl = Ensure-SslModeRequired $DatabaseUrl
$env:DATABASE_URL = $DatabaseUrl

# Detectar host local para desativar SSL (NODE_ENV=development)
try {
  $uri = [System.Uri]$DatabaseUrl
  $isLocal = ($uri.Host -eq "localhost" -or $uri.Host -eq "127.0.0.1")
} catch {
  $isLocal = $false
}

if ($isLocal) {
  $env:NODE_ENV = "development"
} else {
  $env:NODE_ENV = "production"
}

Write-Host "Configuração:" -ForegroundColor Cyan
Write-Host (" - NODE_ENV: {0}" -f $env:NODE_ENV)
Write-Host (" - DATABASE_URL: {0}" -f $env:DATABASE_URL)

# Verificar Node.js
try {
  $null = & node -v
} catch {
  Write-Error "Node.js não encontrado. Instale o Node e tente novamente."
  exit 1
}

# Preparar logging
$ts = Get-Date -Format "yyyyMMdd-HHmmss"
$logDir = Join-Path $rootDir "backup"
if (!(Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$logFile = Join-Path $logDir ("migration-ca-{0}.log" -f $ts)
Write-Host ("Logs serão salvos em: {0}" -f $logFile) -ForegroundColor Cyan

# Backup
Write-Host "Iniciando backup do banco..." -ForegroundColor Green
try {
  & node "$rootDir\scripts\backup_db.js" 2>&1 | Tee-Object -FilePath $logFile -Append | Write-Host
} catch {
  Write-Warning "Falha ao executar backup_db.js: $_"
}

# Dry-run
Write-Host "Executando dry-run da migração CA..." -ForegroundColor Green
try {
  & node "$rootDir\scripts\migrate_assign_marcelo_ca_db.js" 2>&1 | Tee-Object -FilePath $logFile -Append | Write-Host
} catch {
  Write-Error "Erro no dry-run: $_"
  exit 1
}

# Aplicação
$doApply = $false
if ($Apply.IsPresent) {
  $doApply = $true
} else {
  $answer = Read-Host "Aplicar migração agora? (y/n)"
  if ($answer -match '^(y|Y|s|S)') { $doApply = $true }
}

if ($doApply) {
  Write-Host "Aplicando migração CA..." -ForegroundColor Green
  $applyArgs = @("$rootDir\scripts\migrate_assign_marcelo_ca_db.js","--apply")
  if ($ForceCreatedBy.IsPresent) { $applyArgs += "--force-created-by" }
  try {
    & node $applyArgs 2>&1 | Tee-Object -FilePath $logFile -Append | Write-Host
  } catch {
    Write-Error "Erro ao aplicar migração: $_"
    exit 1
  }
} else {
  Write-Host "Aplicação da migração cancelada pelo usuário." -ForegroundColor Yellow
}

# Contagens por país
Write-Host "Verificando contagens por país..." -ForegroundColor Green
try {
  & node "$rootDir\scripts\db_counts.js" 2>&1 | Tee-Object -FilePath $logFile -Append | Write-Host
} catch {
  Write-Warning "Erro ao executar db_counts.js: $_"
}

Write-Host ("Concluído. Consulte o log: {0}" -f $logFile) -ForegroundColor Cyan
