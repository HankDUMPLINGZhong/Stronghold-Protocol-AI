param(
    [string]$GameDirectory,
    [ValidateSet('install', 'check', 'uninstall')][string]$Mode = 'install'
)
$ErrorActionPreference = 'Stop'

function Find-LaviniaGame([string]$Directory) {
    if (-not $Directory) { return $null }
    foreach ($candidate in @($Directory, (Join-Path $Directory 'app'))) {
        if ((Test-Path -LiteralPath (Join-Path $candidate 'server\match\bot.js')) -and
            (Test-Path -LiteralPath (Join-Path $candidate 'shared\protocol.js')) -and
            (Test-Path -LiteralPath (Join-Path $candidate 'package.json'))) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    return $null
}

function Find-LaviniaNode([string]$GameRoot) {
    $parent = Split-Path -Parent $GameRoot
    $candidates = @((Join-Path $GameRoot 'node\node.exe'), (Join-Path $parent 'node\node.exe'))
    $systemNode = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue
    if ($systemNode) { $candidates += $systemNode.Source }
    foreach ($candidate in $candidates) {
        if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
        & $candidate -e 'process.exit(parseInt(process.versions.node) >= 22 ? 0 : 1)' *> $null
        if ($LASTEXITCODE -eq 0) { return $candidate }
    }
    throw '需要 Node.js 22 或更高版本。请使用游戏自带的便携版 Node，或安装 Node.js 后重试。'
}

function Invoke-LaviniaInstaller {
    $gameRoot = $null
    if ($GameDirectory) {
        $gameRoot = Find-LaviniaGame $GameDirectory
        if (-not $gameRoot) { throw "没有找到游戏目录：$GameDirectory" }
    } else {
        # Unzip the addon folder into the source root or beside the Windows bundle's launcher.
        $parent = Split-Path -Parent $PSScriptRoot
        foreach ($candidate in @($PSScriptRoot, $parent, (Split-Path -Parent $parent))) {
            $gameRoot = Find-LaviniaGame $candidate
            if ($gameRoot) { break }
        }
        if (-not $gameRoot) {
            Add-Type -AssemblyName System.Windows.Forms
            $picker = New-Object System.Windows.Forms.FolderBrowserDialog
            try {
                $picker.Description = '选择卫戍协议游戏目录（包含 server 文件夹，或便携版的 app 文件夹）'
                $picker.ShowNewFolderButton = $false
                if ($picker.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
                    Write-Host '已取消，未修改游戏文件。'
                    return 0
                }
                $gameRoot = Find-LaviniaGame $picker.SelectedPath
                if (-not $gameRoot) { throw '所选目录中没有找到游戏文件。' }
            } finally { $picker.Dispose() }
        }
    }
    $nodeExe = Find-LaviniaNode $gameRoot
    Write-Host "游戏目录：$gameRoot"
    Write-Host "Node：$nodeExe"
    & $nodeExe (Join-Path $PSScriptRoot 'install.mjs') $Mode $gameRoot | Out-Host
    if ($LASTEXITCODE -ne 0) { throw '操作失败，详细原因见上方。' }
    if ($Mode -eq 'install') { Write-Host '拉维妮娅 v0.1.2 安装成功。请重新启动游戏服务并刷新浏览器。' }
    elseif ($Mode -eq 'uninstall') { Write-Host '插件已卸载，原文件已恢复。请重新启动游戏服务。' }
    else { Write-Host '兼容性检查通过，未修改游戏文件。' }
    return 0
}

# Dot-sourcing only defines the helpers, allowing non-interactive installer checks.
if ($MyInvocation.InvocationName -ne '.') {
    try { exit (Invoke-LaviniaInstaller) }
    catch { Write-Host "错误：$($_.Exception.Message)" -ForegroundColor Red; exit 1 }
}
