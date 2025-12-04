param(
  [string]$ZipName
)

# Ir para a raiz do repositório (dois níveis acima do script)
$repoRoot = Split-Path -Parent $PSCommandPath | Split-Path -Parent
Set-Location $repoRoot

# Gerar nome com timestamp se não for fornecido
if (-not $ZipName -or $ZipName.Trim() -eq '') {
  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $ZipName = "backup-$timestamp.zip"
}

# Itens a excluir por nome
$excludeNames = @(
  'node_modules',
  'node_modules.zip',
  'versao completa',
  '.git'
)

# Selecionar itens no topo da raiz, excluindo backups e arquivos comprimidos já existentes
$items = Get-ChildItem -Force | Where-Object {
  $name = $_.Name
  $isZip = $name -match '\\.zip$' -or $name -match '\\.7z$' -or $name -match '\\.rar$'
  -not ($excludeNames -contains $name) -and -not ($name -match '^backup-') -and -not $isZip
}

$paths = $items | ForEach-Object { $_.FullName }

if (Test-Path $ZipName) { Remove-Item $ZipName -Force }
Compress-Archive -Path $paths -DestinationPath $ZipName -Force

Write-Host "Backup criado: $ZipName"