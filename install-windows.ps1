param([string]$GameDirectory, [ValidateSet('install','check','uninstall')][string]$Mode='install')
$ErrorActionPreference='Stop'
if (-not $GameDirectory) {
    foreach ($candidate in @($PSScriptRoot,(Split-Path -Parent $PSScriptRoot))) {
        foreach ($root in @($candidate,(Join-Path $candidate 'app'))) {
            if (Test-Path -LiteralPath (Join-Path $root 'server\match\bot.js')) { $GameDirectory=$root; break }
        }
        if ($GameDirectory) { break }
    }
}
$entry=Join-Path $PSScriptRoot 'addons\arturia\install-windows.ps1'
if ($GameDirectory) { & $entry -GameDirectory $GameDirectory -Mode $Mode }
else { & $entry -Mode $Mode }
