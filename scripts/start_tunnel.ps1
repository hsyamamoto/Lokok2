Param(
  [int]$Port = 3000,
  [string]$DiagnosePath = "/diagnose/drive"
)

function Write-Info($msg){
  Write-Host "[INFO] $msg"
}

function Write-Warn($msg){
  Write-Host "[WARN] $msg" -ForegroundColor Yellow
}

$workspace = Split-Path (Split-Path $PSScriptRoot -Parent) -Leaf
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

Write-Info "Workspace: $root"

# 1) Garantir servidor Node rodando
function Test-PortListening($p){
  try {
    $listeners = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
    return ($listeners | Where-Object { $_.Port -eq $p }).Count -gt 0
  } catch {
    return $false
  }
}

if(-not (Test-PortListening -p $Port)){
  Write-Info "Porta $Port livre. Iniciando servidor Node..."
  try {
    Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory $root -WindowStyle Minimized | Out-Null
    Start-Sleep -Seconds 2
    if(Test-PortListening -p $Port){
      Write-Info "Servidor Node iniciado em http://localhost:$Port"
    } else {
      Write-Warn "Nao foi possivel confirmar o servidor na porta $Port. Continuando mesmo assim."
    }
  } catch {
    Write-Warn "Falha ao iniciar Node: $($_.Exception.Message)"
  }
} else {
  Write-Info "Servidor ja esta ouvindo em http://localhost:$Port"
}

# 2) Localizar cloudflared
$cloudflared = $null
try {
  $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
  if($cmd){ $cloudflared = $cmd.Source }
} catch {}
if(-not $cloudflared){
  $wingetPath = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages\Cloudflare.cloudflared_Microsoft.Winget.Source_8wekyb3d8bbwe\cloudflared.exe"
  if(Test-Path $wingetPath){ $cloudflared = $wingetPath }
}

if(-not $cloudflared){
  Write-Warn "cloudflared nao encontrado. Instale com: winget install Cloudflare.cloudflared"
  exit 1
}
Write-Info "cloudflared: $cloudflared"

# 3) Abrir quick tunnel e capturar URL
$logFile = Join-Path $env:TEMP "cloudflared-quick-tunnel.log"
if(Test-Path $logFile){ Remove-Item $logFile -Force }

Write-Info "Abrindo Quick Tunnel..."
$args = @("tunnel","--url","http://localhost:$Port","--no-autoupdate","--logfile","$logFile","--loglevel","info")
try {
  $proc = Start-Process -FilePath $cloudflared -ArgumentList $args -WorkingDirectory $root -WindowStyle Minimized -PassThru
} catch {
  Write-Warn "Falha ao iniciar cloudflared: $($_.Exception.Message)"
  exit 1
}

# 4) Aguardar URL no log
$publicUrl = $null
for($i=0; $i -lt 40 -and -not $publicUrl; $i++){
  Start-Sleep -Milliseconds 800
  if(Test-Path $logFile){
    $line = Select-String -Path $logFile -Pattern "https://.*trycloudflare.com" | Select-Object -Last 1
    if($line){
      $m = [regex]::Match($line.Line, "https://[a-zA-Z0-9\-\.]+\.trycloudflare\.com")
      if($m.Success){ $publicUrl = $m.Value }
    }
  }
}

if(-not $publicUrl){
  Write-Warn "Nao consegui capturar a URL do tunnel. Veja o log: $logFile"
  exit 2
}

Write-Host "PUBLIC_URL=$publicUrl"
Write-Info "Abrindo diagnostico: $publicUrl$DiagnosePath"

try { Start-Process "$publicUrl$DiagnosePath" | Out-Null } catch {}

Write-Info "Se aparecer 'Tunnel website ahead!', clique em 'Visit site' e tente novamente."
exit 0
