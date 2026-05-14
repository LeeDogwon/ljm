param(
  [ValidateSet("start", "stop", "status", "logs")]
  [string] $Action = "status"
)

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$LogDir = Join-Path $ProjectRoot "logs"
$OutLog = Join-Path $LogDir "bot.out.log"
$ErrLog = Join-Path $LogDir "bot.err.log"

function Get-BotProcess {
  Get-CimInstance Win32_Process |
    Where-Object {
      $_.Name -eq "node.exe" -and
      $_.CommandLine -match "src[/\\]index\.js"
    }
}

switch ($Action) {
  "start" {
    New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
    $existing = Get-BotProcess
    if ($existing) {
      Write-Host "Bot is already running:"
      $existing | Select-Object ProcessId, CommandLine
      exit 0
    }

    Start-Process `
      -FilePath "npm.cmd" `
      -ArgumentList @("start") `
      -WorkingDirectory $ProjectRoot `
      -WindowStyle Hidden `
      -RedirectStandardOutput $OutLog `
      -RedirectStandardError $ErrLog

    Start-Sleep -Seconds 2
    Get-BotProcess | Select-Object ProcessId, CommandLine
  }
  "stop" {
    $existing = Get-BotProcess
    if (-not $existing) {
      Write-Host "Bot is not running."
      exit 0
    }

    $existing | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
    Write-Host "Bot stopped."
  }
  "status" {
    $existing = Get-BotProcess
    if ($existing) {
      Write-Host "Bot is running:"
      $existing | Select-Object ProcessId, CommandLine
    } else {
      Write-Host "Bot is not running."
    }
  }
  "logs" {
    Write-Host "== stdout =="
    if (Test-Path $OutLog) { Get-Content $OutLog -Tail 80 }
    Write-Host "== stderr =="
    if (Test-Path $ErrLog) { Get-Content $ErrLog -Tail 80 }
  }
}
