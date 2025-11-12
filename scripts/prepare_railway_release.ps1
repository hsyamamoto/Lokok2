Param(
  [string]$ZipName = "lokok2-railway-release.zip"
)

$repoRoot = Split-Path -Parent $PSCommandPath | Split-Path -Parent
Set-Location $repoRoot

$excludeNames = @(
  'node_modules',
  'node_modules.zip',
  'versao completa'
)

$items = Get-ChildItem -Force | Where-Object {
  $name = $_.Name
  -not ($excludeNames -contains $name) -and -not ($name -match '^backup-')
}

$paths = $items | ForEach-Object { $_.FullName }

if (Test-Path $ZipName) { Remove-Item $ZipName -Force }
Compress-Archive -Path $paths -DestinationPath $ZipName -Force

Write-Host "Release criado: $ZipName"