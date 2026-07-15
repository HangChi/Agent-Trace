param(
  [Parameter(Mandatory = $true)][string]$PreviousInstaller,
  [Parameter(Mandatory = $true)][string]$CurrentInstaller
)

$ErrorActionPreference = "Stop"
$PreviousInstaller = (Resolve-Path -LiteralPath $PreviousInstaller).Path
$CurrentInstaller = (Resolve-Path -LiteralPath $CurrentInstaller).Path
$Root = Join-Path ([System.IO.Path]::GetTempPath()) ("agent-trace-upgrade-e2e-" + [guid]::NewGuid().ToString("N"))
$InstallDir = Join-Path $Root "app"
$UserData = Join-Path $Root "user-data"
$ResultPath = Join-Path $UserData "lifecycle-result.json"

New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
New-Item -ItemType Directory -Path $UserData -Force | Out-Null

try {
  Invoke-Installer $PreviousInstaller $InstallDir
  $Executable = Join-Path $InstallDir "Agent-Trace.exe"
  if (-not (Test-Path -LiteralPath $Executable)) { throw "Previous installer did not create Agent-Trace.exe" }
  $PreviousVersion = (Get-Item -LiteralPath $Executable).VersionInfo.FileVersion

  Invoke-Installer $CurrentInstaller $InstallDir
  if (-not (Test-Path -LiteralPath $Executable)) { throw "Upgrade removed Agent-Trace.exe" }
  $CurrentVersion = (Get-Item -LiteralPath $Executable).VersionInfo.FileVersion

  $env:AGENT_TRACE_DESKTOP_E2E_DIR = $UserData
  $env:AGENT_TRACE_USAGE_SCAN = "0"
  $env:AGENT_TRACE_DB_PATH = Join-Path $UserData "agent-trace.db"
  $Process = Start-Process -FilePath $Executable -PassThru -WindowStyle Hidden
  if (-not $Process.WaitForExit(120000)) {
    $Process.Kill($true)
    throw "Upgraded desktop app did not exit within 120 seconds"
  }
  if ($Process.ExitCode -ne 0) { throw "Upgraded desktop app exited with $($Process.ExitCode)" }
  if (-not (Test-Path -LiteralPath $ResultPath)) { throw "Upgraded desktop app did not produce lifecycle result" }
  $Result = Get-Content -Raw -LiteralPath $ResultPath | ConvertFrom-Json
  if ($Result.error) { throw "Upgraded desktop app failed: $($Result.error)" }

  Write-Output "Agent-Trace installer upgrade E2E passed: $PreviousVersion -> $CurrentVersion"
} finally {
  $Uninstaller = Join-Path $InstallDir "Uninstall Agent-Trace.exe"
  if (Test-Path -LiteralPath $Uninstaller) {
    Start-Process -FilePath $Uninstaller -ArgumentList "/S" -Wait -WindowStyle Hidden
  }
  $ResolvedRoot = [System.IO.Path]::GetFullPath($Root)
  $ResolvedTemp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
  if ($ResolvedRoot.StartsWith($ResolvedTemp, [System.StringComparison]::OrdinalIgnoreCase) -and
      (Split-Path -Leaf $ResolvedRoot).StartsWith("agent-trace-upgrade-e2e-")) {
    Remove-Item -LiteralPath $ResolvedRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Invoke-Installer([string]$Installer, [string]$Target) {
  $Process = Start-Process -FilePath $Installer -ArgumentList "/S", "/D=$Target" -PassThru -Wait -WindowStyle Hidden
  if ($Process.ExitCode -ne 0) { throw "Installer $Installer exited with $($Process.ExitCode)" }
}
