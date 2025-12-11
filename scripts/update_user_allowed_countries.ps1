Param(
  [Parameter(Mandatory=$true)][int]$UserId,
  [Parameter(Mandatory=$true)][string]$Email,
  [Parameter(Mandatory=$true)][string]$Name,
  [Parameter(Mandatory=$true)][string]$Role,
  [Parameter(Mandatory=$true)][string]$AllowedCountriesCsv,
  [Parameter(Mandatory=$false)][string]$CookiesFile = "cookies.txt",
  [Parameter(Mandatory=$false)][string]$BaseUrl = "https://lokok2-production.up.railway.app"
)

function Get-CookieHeaderFromFile {
  param([string]$Path)
  if (-not (Test-Path $Path)) { throw "Cookies file not found: $Path" }
  $lines = Get-Content -Path $Path | Where-Object { $_ -and (($_ -notmatch '^#') -or ($_ -match '^#HttpOnly_')) }
  $sid = $null; $sig = $null
  foreach ($line in $lines) {
    $parts = $line -split "`t"
    if ($parts.Length -ge 7) {
      $cookieName = $parts[5]
      $cookieValue = $parts[6]
      if ($cookieName -eq 'lokok.sid') { $sid = $cookieValue }
      elseif ($cookieName -eq 'lokok.sid.sig') { $sig = $cookieValue }
    }
  }
  if (-not $sid -or -not $sig) { throw "Required cookies not found in file: $Path" }
  return "lokok.sid=$sid; lokok.sid.sig=$sig"
}

try {
  $cookieHeader = Get-CookieHeaderFromFile -Path $CookiesFile
  $allowed = $AllowedCountriesCsv.Split(',') | ForEach-Object { $_.Trim().ToUpper() } | Where-Object { $_ -ne '' }
  $bodyObj = @{ name = $Name; email = $Email; role = $Role; allowedCountries = $allowed }
  $json = $bodyObj | ConvertTo-Json -Depth 5
  $headers = @{ 'Content-Type' = 'application/json'; 'Cookie' = $cookieHeader }
  $uri = "$BaseUrl/api/users/$UserId"
  Write-Host "Atualizando usuário $UserId ($Email) com allowedCountries: $($allowed -join ',')..."
  $resp = Invoke-RestMethod -Method Put -Uri $uri -Headers $headers -Body $json
  Write-Host "Resposta:" ($resp | ConvertTo-Json -Depth 5)
} catch {
  Write-Error "Falha ao atualizar usuário: $($_.Exception.Message)"
  if ($_.ErrorDetails.Message) { Write-Error $_.ErrorDetails.Message }
  exit 1
}
