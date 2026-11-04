# 小抄的拓展 · 微端安装器（Windows，嵌入在 install.bat 中运行）
# 前置：官方三国杀微端已安装「小抄微端插件」（resources\app 存在）。
# 作用：把拓展注入微端插件的 app，并让官方微端的自动更新保留拓展。

$ErrorActionPreference = 'Stop'

$MARK_IPC = '==XC-EXT-IPC=='
$MARK_INJECT = '==XC-EXT-INJECT=='

function Write-InstallMessage {
    param([string]$Message)
    Write-Host $Message
    try {
        Add-Content -LiteralPath (Join-Path $env:XC_INSTALL_ROOT 'install.log') -Value ('[{0}] {1}' -f (Get-Date), $Message) -Encoding UTF8 -ErrorAction Stop
    } catch {
        Write-Warning ('无法写入 install.log：' + $_.Exception.Message)
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
        if ([IO.Path]::GetFileName($root) -ieq 'resources' -and (Test-Path -LiteralPath (Join-Path $root 'app') -PathType Container)) {
            return $root
        }
    }
    $candidates = @()
    if ($env:ProgramFiles) { $candidates += (Join-Path $env:ProgramFiles 'SGSOL\resources') }
    if (${env:ProgramFiles(x86)}) { $candidates += (Join-Path ${env:ProgramFiles(x86)} 'SGSOL\resources') }
    if ($env:LOCALAPPDATA) { $candidates += (Join-Path $env:LOCALAPPDATA 'Programs\SGSOL\resources') }
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath (Join-Path $candidate 'app\package.json') -PathType Leaf) {
            return $candidate
        }
    }
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath (Join-Path $candidate 'app.asar') -PathType Leaf) {
            return $candidate
        }
    }
    return ''
}

function Read-ScriptVersion {
    param([string]$Path)
    $text = [IO.File]::ReadAllText($Path, [Text.Encoding]::UTF8)
    $match = [regex]::Match($text, '@version\s+([\d.]+)')
    if (-not $match.Success) { return '' }
    return $match.Groups[1].Value
}

function Install-XcExt {
    param([string]$Resources)

    $app = Join-Path $Resources 'app'
    $stage = Join-Path $Resources '.xc-ext-install'
    $backup = Join-Path $Resources '.xc-ext-rollback'
    $payload = Join-Path $env:XC_INSTALL_ROOT 'xc-ext'

    foreach ($relative in @('package.json', 'main.js', 'xiaochao.js', 'script/electron_renderer.js')) {
        if (-not (Test-Path -LiteralPath (Join-Path $app $relative) -PathType Leaf)) {
            throw ('resources\app 里缺少 ' + $relative + '，当前安装可能不是小抄微端插件，或插件版本结构已变化。')
        }
    }
    $payloadScript = Join-Path $payload 'xc-ext.js'
    $patchScript = Join-Path $env:XC_INSTALL_ROOT 'xc-ext/apply-patch.ps1'
    if (-not (Test-Path -LiteralPath $payloadScript -PathType Leaf)) { throw '安装包不完整：缺少 xc-ext\xc-ext.js。' }
    if (-not (Test-Path -LiteralPath $patchScript -PathType Leaf)) { throw '安装包不完整：缺少 xc-ext\apply-patch.ps1。' }

    if (Get-Process -Name SGSOL -ErrorAction SilentlyContinue) {
        throw '三国杀微端仍在运行，请先完全退出（包括托盘图标）。'
    }

    $extVersion = Read-ScriptVersion $payloadScript
    if (-not $extVersion) { throw '无法读取拓展脚本版本号，安装包可能不完整。' }
    $clientVersion = '未知'
    try {
        $package = Get-Content -LiteralPath (Join-Path $app 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($package.version) { $clientVersion = [string]$package.version }
    } catch {}

    Write-InstallMessage ('检测到小抄微端插件 v' + $clientVersion + '，准备安装拓展 v' + $extVersion + '。')

    $dest = Join-Path $Resources 'xc-ext'
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    Copy-Item -Path (Join-Path $payload '*') -Destination $dest -Recurse -Force
    Write-InstallMessage ('已更新拓展文件：' + $dest)

    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
    if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Recurse -Force }
    New-Item -ItemType Directory -Path $stage | Out-Null

    try {
        Write-InstallMessage '正在复制并打补丁，现有安装保持不变。'
        Copy-Item -LiteralPath $app -Destination $stage -Recurse -Force
        $stagedApp = Join-Path $stage 'app'
        & $patchScript -AppDir $stagedApp -ResourcesDir $Resources
        if ($LASTEXITCODE -ne 0) { throw ('补丁脚本返回失败（exit ' + $LASTEXITCODE + '）。') }

        $mainText = [IO.File]::ReadAllText((Join-Path $stagedApp 'main.js'), [Text.Encoding]::UTF8)
        $rendererText = [IO.File]::ReadAllText((Join-Path $stagedApp 'script/electron_renderer.js'), [Text.Encoding]::UTF8)
        if (-not $mainText.Contains($MARK_IPC)) { throw '补丁校验失败：main.js 未注入。' }
        if (-not $rendererText.Contains($MARK_INJECT)) { throw '补丁校验失败：electron_renderer.js 未注入。' }

        if (Get-Process -Name SGSOL -ErrorAction SilentlyContinue) {
            throw '三国杀微端在安装过程中被打开了，请完全退出后重试。'
        }

        Write-InstallMessage '校验通过，正在替换 app 目录；旧文件保留到安装成功。'
        Move-Item -LiteralPath $app -Destination $backup
        try {
            Move-Item -LiteralPath $stagedApp -Destination $app
        } catch {
            Move-Item -LiteralPath $backup -Destination $app
            throw
        }
        Remove-Item -LiteralPath $backup -Recurse -Force
        Remove-Item -LiteralPath $stage -Recurse -Force
    } catch {
        $installError = $_
        try {
            if (-not (Test-Path -LiteralPath $app) -and (Test-Path -LiteralPath $backup)) {
                Move-Item -LiteralPath $backup -Destination $app
            }
            if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
        } catch {
            Write-InstallMessage ('自动清理失败：' + ($_ | Out-String))
        }
        throw $installError
    }

    $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    try {
        $info = @(
            ('拓展版本：' + $extVersion)
            ('小抄微端插件版本：' + $clientVersion)
            ('安装时间：' + $stamp)
            ('resources：' + $Resources)
        )
        [IO.File]::WriteAllLines((Join-Path $dest 'installed.txt'), $info, (New-Object System.Text.UTF8Encoding($false)))
    } catch {}

    Write-InstallMessage ('安装成功：小抄的拓展 v' + $extVersion + ' 已注入微端。')
    Write-InstallMessage '重新打开三国杀微端即可生效。'
    Write-InstallMessage '小抄微端插件自动更新时会自动重新打补丁，拓展不会丢失。'
    Write-InstallMessage '更新拓展：下载新版安装包后重新运行 install.bat 即可（设置与缓存都会保留）。'
}

try {
    Write-InstallMessage ('开始安装小抄的拓展（微端），时间：' + (Get-Date))
    Write-InstallMessage ('Windows PowerShell 版本：' + $PSVersionTable.PSVersion)

    $resources = Resolve-ResourcesDir
    if (-not $resources) {
        throw ('未找到三国杀微端的 resources 目录。' +
            '请先安装官方三国杀微端和 xiaochao.org 的「微端插件」；' +
            '如果微端装在非默认位置，可运行：install.bat "微端的 resources 目录"')
    }
    if (-not (Test-Path -LiteralPath (Join-Path $resources 'app\package.json') -PathType Leaf)) {
        throw ('在 ' + $resources + ' 下没有找到小抄微端插件（app 目录）。' +
            '请先按 xiaochao.org 的说明下载「微端插件」并安装，完全退出微端后再运行本安装器。')
    }
    if (-not (Test-CanWrite $resources) -and -not (Test-IsAdmin)) {
        throw '当前目录需要管理员权限：请右键点击 install.bat，选择「以管理员身份运行」。'
    }
    Install-XcExt -Resources $resources
    exit 0
} catch {
    Write-InstallMessage ('错误：' + ($_ | Out-String))
    Write-Host '请查看上方的具体报错和同目录下的 install.log。'
    exit 1
}
