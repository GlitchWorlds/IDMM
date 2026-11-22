# IDMM Extension Injector Script
# Modifies browser shortcuts to inject --load-extension for Chrome and Edge.
# Called from NSIS installer with elevated privileges.
# Parameters:
#   $ExtPath  - Path to extension directory (e.g., C:\Program Files\IDMM\resources\extension)
#   $Action   - "install" or "uninstall"

param(
  [string]$ExtPath = "$args[0]",
  [string]$Action = "$args[1]"  # "install" or "uninstall"
)

$ws = New-Object -ComObject WScript.Shell
$extArg = '--load-extension="' + $ExtPath + '"'

# Chrome + Edge shortcut locations
$smPaths = @(
  @{ Name = 'Chrome'; Path = [Environment]::GetFolderPath('CommonStartMenu') + '\Programs\Google Chrome.lnk' },
  @{ Name = 'Edge';   Path = [Environment]::GetFolderPath('CommonStartMenu') + '\Programs\Microsoft Edge.lnk' }
)

foreach ($entry in $smPaths) {
  $shPath = $entry.Path
  $name   = $entry.Name

  if (-not (Test-Path $shPath)) {
    Write-Host "[SKIP] $name shortcut not found at $shPath"
    continue
  }

  try {
    $sh = $ws.CreateShortcut($shPath)

    if ($Action -eq 'uninstall') {
      # Remove --load-extension
      if ($sh.Arguments -match 'load-extension') {
        $sh.Arguments = ($sh.Arguments -replace '--load-extension=[^ ]+', '').Trim()
        $sh.Save()
        Write-Host "[OK] $name shortcut cleaned"
      } else {
        Write-Host "[--] $name shortcut has no load-extension, skip"
      }
    } else {
      # Install / add
      if ($sh.Arguments -notmatch 'load-extension') {
        $sh.Arguments = ($extArg + ' ' + $sh.Arguments).Trim()
        $sh.Save()
        Write-Host "[OK] $name shortcut injected with --load-extension"
      } else {
        Write-Host "[--] $name already has load-extension, skip"
      }
    }
  } catch {
    Write-Host "[ERR] $name $($entry.Name) error: $($_.Exception.Message)"
  }
}
