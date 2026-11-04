# xc-ext 微端补丁：把「小抄的拓展」注入小抄微端插件的 app 目录，
# 并给官方微端的自动更新器打上补丁，让更新后仍保留拓展。
#
# 调用：powershell -ExecutionPolicy Bypass -File apply-patch.ps1 -AppDir <app目录> -ResourcesDir <resources目录>
# 幂等：重复执行只会跳过已打过的补丁。
param(
    [Parameter(Mandatory = $true)][string]$AppDir,
    [Parameter(Mandatory = $true)][string]$ResourcesDir
)

$ErrorActionPreference = 'Stop'

$MARK_IPC = '==XC-EXT-IPC=='
$MARK_INJECT = '==XC-EXT-INJECT=='
$MARK_UPDATER = '==XC-EXT-PATCH=='

$status = New-Object System.Collections.ArrayList
function Add-Status([string]$Text) {
    [void]$status.Add($Text)
}

function Read-Utf8([string]$Path) {
    return [IO.File]::ReadAllText($Path, [Text.Encoding]::UTF8)
}

function Write-Utf8([string]$Path, [string]$Text) {
    [IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false)))
}

function Add-AppendBlock([string]$Path, [string]$Marker, [string]$Block) {
    $text = Read-Utf8 $Path
    if ($text.Contains($Marker)) {
        Add-Status ('已存在，跳过：' + (Split-Path -Leaf $Path))
        return
    }
    if (-not $text.EndsWith("`n")) { $text += "`n" }
    Write-Utf8 $Path ($text + $Block)
    Add-Status ('已注入：' + (Split-Path -Leaf $Path))
}

function Insert-Hook([string]$Path, [string]$Anchor, [string]$Insert, [bool]$Before, [string]$Label) {
    $text = Read-Utf8 $Path
    if ($text.Contains($MARK_UPDATER)) {
        Add-Status ('更新跟随补丁已存在，跳过：' + $Label)
        return
    }
    $index = $text.IndexOf($Anchor, [StringComparison]::Ordinal)
    if ($index -lt 0) {
        Add-Status ('警告：找不到插桩位置，未打更新跟随补丁：' + $Label)
        return
    }
    if ($Before) {
        $text = $text.Insert($index, $Insert)
    } else {
        $text = $text.Insert($index + $Anchor.Length, $Insert)
    }
    Write-Utf8 $Path $text
    Add-Status ('已打更新跟随补丁：' + $Label)
}

# main.js 末尾注册同步 IPC：渲染进程通过它拿到拓展脚本（脚本放在 resources/xc-ext，不随 app 更新被覆盖）。
$ipcBlock = @'

;/* ==XC-EXT-IPC== */
(function () {
    try {
        var electron = require('electron');
        var path = require('path');
        var fs = require('fs');
        if (!electron || !electron.ipcMain || typeof electron.ipcMain.on !== 'function') return;
        electron.ipcMain.on('xc-ext-source', function (event) {
            var result = { ok: false, error: 'xc-ext.js not found' };
            try {
                var roots = [];
                try { roots.push(process.resourcesPath); } catch (e0) {}
                try { roots.push(path.join(__dirname, '..')); } catch (e1) {}
                for (var i = 0; i < roots.length; i++) {
                    var file = path.join(roots[i], 'xc-ext', 'xc-ext.js');
                    if (!fs.existsSync(file)) continue;
                    var code = fs.readFileSync(file, 'utf8');
                    var match = code.match(/@version\s+([\d.]+)/);
                    result = { ok: true, version: match ? match[1] : '', code: code };
                    break;
                }
            } catch (err) {
                result = { ok: false, error: String((err && err.message) || err) };
            }
            event.returnValue = result;
        });
    } catch (err) {
        console.error('[xc-ext] IPC 注册失败', err);
    }
})();
'@

# 游戏页 preload 顶部（document-start）同步注入拓展，早于页面脚本和小抄脚本。
$injectBlock = @'

;/* ==XC-EXT-INJECT== */
(function () {
    try {
        if (window.__XC_EXT_INJECT_STARTED__) return;
        window.__XC_EXT_INJECT_STARTED__ = true;
        var response = ipcRenderer.sendSync('xc-ext-source');
        if (!response || !response.ok || !response.code) {
            console.error('[xc-ext] 拓展脚本不可用：' + ((response && response.error) || 'unknown'));
            return;
        }
        var pending = webFrame.executeJavaScript(response.code);
        if (pending && typeof pending.catch === 'function') {
            pending.catch(function (err) { console.error('[xc-ext] 拓展脚本执行失败', err); });
        } else {
            console.log('[xc-ext] 拓展脚本已注入 v' + (response.version || '?'));
        }
    } catch (err) {
        console.error('[xc-ext] 拓展脚本注入异常', err);
    }
})();
'@

# Windows 更新器模板（micro-client-updater.js）里，解压完新 app 之后先跑一遍本补丁。
$winAnchor = 'Expand-Archive -LiteralPath $Archive -DestinationPath $StageRoot -Force'
$winInsert = @'
  # ==XC-EXT-PATCH==
  try { & (Join-Path $Resources 'xc-ext/apply-patch.ps1') $NewApp $Resources } catch { Write-UpdateLog ('xc-ext patch failed: ' + ($_ | Out-String)) }
'@
$winInsert = "`n" + $winInsert

# macOS 更新器模板（main.js 内嵌 bash）里，解压完新 app 之后先跑一遍本补丁。
$macAnchor = 'if [ ! -f "$NEW_APP/package.json" ]; then'
$macInsert = @'
# ==XC-EXT-PATCH==
bash "$RESOURCES/xc-ext/apply-patch.sh" "$NEW_APP" "$RESOURCES" || log_error "xc-ext patch failed"
'@
$macInsert = $macInsert + "`n"

$mainJs = Join-Path $AppDir 'main.js'
$rendererJs = Join-Path $AppDir 'script/electron_renderer.js'
$updaterJs = Join-Path $AppDir 'micro-client-updater.js'

if (-not (Test-Path -LiteralPath $mainJs -PathType Leaf)) { throw ('缺少 app/main.js：' + $AppDir) }
if (-not (Test-Path -LiteralPath $rendererJs -PathType Leaf)) { throw ('缺少 app/script/electron_renderer.js：' + $AppDir) }

Add-AppendBlock $mainJs $MARK_IPC $ipcBlock
Add-AppendBlock $rendererJs $MARK_INJECT $injectBlock

if (Test-Path -LiteralPath $updaterJs -PathType Leaf) {
    Insert-Hook $updaterJs $winAnchor $winInsert $false 'micro-client-updater.js（Windows 更新器）'
} else {
    Add-Status '未找到 micro-client-updater.js，跳过 Windows 更新跟随补丁'
}
Insert-Hook $mainJs $macAnchor $macInsert $true 'main.js（macOS 更新器）'

$mainText = Read-Utf8 $mainJs
$rendererText = Read-Utf8 $rendererJs
if (-not $mainText.Contains($MARK_IPC)) { throw '注入失败：main.js 中找不到 IPC 标记' }
if (-not $rendererText.Contains($MARK_INJECT)) { throw '注入失败：electron_renderer.js 中找不到注入标记' }

$statusFile = Join-Path $ResourcesDir 'xc-ext/patch-status.txt'
try {
    $head = '[{0}] app={1}' -f (Get-Date).ToString('s'), $AppDir
    $lines = @($head) + @($status | ForEach-Object { $_ })
    [IO.File]::WriteAllLines($statusFile, $lines, (New-Object System.Text.UTF8Encoding($false)))
} catch {
    Add-Status ('写 patch-status.txt 失败：' + $_.Exception.Message)
}

foreach ($line in $status) { Write-Host ('  ' + $line) }
exit 0
