# 小抄的拓展 · 微端恢复脚本（Windows，嵌入在 restore.bat 中运行）
# 删除微端插件 app 目录并还原官方 app.asar，等于把微端恢复到官方原版。
# 注意：小抄微端插件也会一起被移除，需要时请重新安装插件，再安装拓展。

$ErrorActionPreference = 'Stop'

function Write-RestoreMessage {
    param([string]$Message)
    Write-Host $Message
    try {
        Add-Content -LiteralPath (Join-Path $env:XC_INSTALL_ROOT 'restore.log') -Value ('[{0}] {1}' -f (Get-Date), $Message) -Encoding UTF8 -ErrorAction Stop
    } catch {
        Write-Warning ('无法写入 restore.log：' + $_.Exception.Message)
    }
}

function Test-IsAdmin {
    try {
        $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
        $principal = New-Object Security.Principal.WindowsPrincipal($identity)
        return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    } catch {
        return $false
    }
}

function Test-CanWrite {
    param([string]$Path)
    try {
        $probe = Join-Path $Path ('.xc-ext-probe-' + [Guid]::NewGuid().ToString('N') + '.tmp')
        [IO.File]::WriteAllText($probe, 'probe')
        [IO.File]::Delete($probe)
        return $true
    } catch {
        return $false
    }
}

function Resolve-ResourcesDir {
    $explicitPath = $env:XC_RESOURCES
    if ($explicitPath) {
        $explicitPath = $explicitPath.Trim('"').Trim()
        if (-not (Test-Path -LiteralPath $explicitPath -PathType Container)) {
            throw ('指定的 resources 目录不存在：' + $explicitPath)
        }
        return (Resolve-Path -LiteralPath $explicitPath).Path
    }
    $root = $env:XC_INSTALL_ROOT
    if ($root) {
        $root = (Resolve-Path -LiteralPath $root).Path
        if ([IO.Path]::GetFileName($root) -ieq 'resources') { return $root }
    }
    $candidates = @()
    if ($env:ProgramFiles) { $candidates += (Join-Path $env:ProgramFiles 'SGSOL\resources') }
    if (${env:ProgramFiles(x86)}) { $candidates += (Join-Path ${env:ProgramFiles(x86)} 'SGSOL\resources') }
    if ($env:LOCALAPPDATA) { $candidates += (Join-Path $env:LOCALAPPDATA 'Programs\SGSOL\resources') }
    foreach ($candidate in $candidates) {
        if ((Test-Path -LiteralPath (Join-Path $candidate 'app') -PathType Container) -or
            (Test-Path -LiteralPath (Join-Path $candidate 'app.asar.bak') -PathType Leaf)) {
            return $candidate
        }
    }
    return ''
}

try {
    Write-RestoreMessage ('开始恢复官方微端，时间：' + (Get-Date))

    if (Get-Process -Name SGSOL -ErrorAction SilentlyContinue) {
        throw '三国杀微端仍在运行，请先完全退出（包括托盘图标）。'
    }

    $resources = Resolve-ResourcesDir
    if (-not $resources) {
        throw ('未找到三国杀微端的 resources 目录。如果微端装在非默认位置，可运行：restore.bat "微端的 resources 目录"')
    }
    if (-not (Test-CanWrite $resources) -and -not (Test-IsAdmin)) {
        throw '当前目录需要管理员权限：请右键点击 restore.bat，选择「以管理员身份运行」。'
    }

    $app = Join-Path $resources 'app'
    $asar = Join-Path $resources 'app.asar'
    $asarBackup = Join-Path $resources 'app.asar.bak'

    foreach ($stale in @('.xc-ext-install', '.xc-ext-rollback')) {
        $path = Join-Path $resources $stale
        if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force }
    }

    if (Test-Path -LiteralPath $app -PathType Container) {
        Write-RestoreMessage '正在删除微端插件 app 目录…'
        Remove-Item -LiteralPath $app -Recurse -Force
    }
    if (Test-Path -LiteralPath $app -PathType Container) {
        throw '无法删除 app 目录，可能仍被占用。'
    }

    if (Test-Path -LiteralPath $asarBackup -PathType Leaf) {
        Write-RestoreMessage '正在还原官方 app.asar…'
        Move-Item -LiteralPath $asarBackup -Destination $asar
    } elseif (-not (Test-Path -LiteralPath $asar -PathType Leaf)) {
        Write-RestoreMessage '警告：既没有 app.asar.bak，也没有 app.asar，微端可能无法启动。请重新安装官方微端。'
    }

    $payload = Join-Path $resources 'xc-ext'
    if (Test-Path -LiteralPath $payload) {
        Remove-Item -LiteralPath $payload -Recurse -Force
        Write-RestoreMessage '已移除拓展文件（resources\xc-ext）。'
    }

    Write-RestoreMessage '恢复完成：已回到官方微端。小抄微端插件也已移除，需要时请重新安装。'
} catch {
    Write-RestoreMessage ('错误：' + ($_ | Out-String))
    Write-Host '请查看上方的具体报错和同目录下的 restore.log。'
    exit 1
}
exit 0
