#!/bin/bash
# xc-ext 微端补丁（macOS）：把「小抄的拓展」注入小抄微端插件的 app 目录，
# 并给官方微端的自动更新器打上补丁，让更新后仍保留拓展。
#
# 调用：bash apply-patch.sh <app目录> <Resources目录>
# 幂等：重复执行只会跳过已打过的补丁。
set -euo pipefail

APP_DIR="${1:-}"
RESOURCES_DIR="${2:-}"
MARK_IPC='==XC-EXT-IPC=='
MARK_INJECT='==XC-EXT-INJECT=='
MARK_UPDATER='==XC-EXT-PATCH=='

if [ -z "$APP_DIR" ] || [ -z "$RESOURCES_DIR" ]; then
    echo '用法：bash apply-patch.sh <app目录> <Resources目录>'
    exit 1
fi

STATUS_LINES=""
add_status() {
    echo "  $1"
    STATUS_LINES="${STATUS_LINES}$1
"
}

append_block() {
    file="$1"
    marker="$2"
    blockfile="$3"
    if grep -q "$marker" "$file" 2>/dev/null; then
        add_status "已存在，跳过：$(basename "$file")"
        return 0
    fi
    if [ -n "$(tail -c 1 "$file")" ]; then
        printf '\n' >> "$file"
    fi
    cat "$blockfile" >> "$file"
    add_status "已注入：$(basename "$file")"
}

insert_before() {
    file="$1"
    anchor="$2"
    insfile="$3"
    label="$4"
    if grep -q "$MARK_UPDATER" "$file" 2>/dev/null; then
        add_status "更新跟随补丁已存在，跳过：$label"
        return 0
    fi
    tmp="$file.xc-ext-tmp"
    if ! awk -v anchor="$anchor" -v insfile="$insfile" '
        index($0, anchor) && !done {
            while ((getline line < insfile) > 0) print line
            close(insfile)
            done = 1
        }
        { print }
    ' "$file" > "$tmp"; then
        rm -f "$tmp"
        add_status "警告：写入失败：$label"
        return 1
    fi
    if ! grep -q "$MARK_UPDATER" "$tmp"; then
        rm -f "$tmp"
        add_status "警告：找不到插桩位置，未打更新跟随补丁：$label"
        return 0
    fi
    mv "$tmp" "$file"
    add_status "已打更新跟随补丁：$label"
}

MAIN_JS="$APP_DIR/main.js"
RENDERER_JS="$APP_DIR/script/electron_renderer.js"

if [ ! -f "$MAIN_JS" ]; then
    echo "缺少 app/main.js：$APP_DIR"
    exit 1
fi
if [ ! -f "$RENDERER_JS" ]; then
    echo "缺少 app/script/electron_renderer.js：$APP_DIR"
    exit 1
fi

TMPDIR_XC="$(mktemp -d "${TMPDIR:-/tmp}/xc-ext-patch.XXXXXX")"
trap 'rm -rf "$TMPDIR_XC"' EXIT

cat > "$TMPDIR_XC/main-block.js" <<'XCEXT_EOF'

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
XCEXT_EOF

cat > "$TMPDIR_XC/renderer-block.js" <<'XCEXT_EOF'

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
XCEXT_EOF

cat > "$TMPDIR_XC/mac-hook.txt" <<'XCEXT_EOF'
# ==XC-EXT-PATCH==
bash "$RESOURCES/xc-ext/apply-patch.sh" "$NEW_APP" "$RESOURCES" || log_error "xc-ext patch failed"
XCEXT_EOF

append_block "$MAIN_JS" "$MARK_IPC" "$TMPDIR_XC/main-block.js"
append_block "$RENDERER_JS" "$MARK_INJECT" "$TMPDIR_XC/renderer-block.js"

insert_before "$MAIN_JS" 'if [ ! -f "$NEW_APP/package.json" ]; then' "$TMPDIR_XC/mac-hook.txt" 'main.js（macOS 更新器）'

if ! grep -q "$MARK_IPC" "$MAIN_JS"; then
    echo '注入失败：main.js 中找不到 IPC 标记'
    exit 1
fi
if ! grep -q "$MARK_INJECT" "$RENDERER_JS"; then
    echo '注入失败：electron_renderer.js 中找不到注入标记'
    exit 1
fi

STATUS_FILE="$RESOURCES_DIR/xc-ext/patch-status.txt"
{
    printf '[%s] app=%s\n' "$(date '+%Y-%m-%dT%H:%M:%S')" "$APP_DIR"
    printf '%s' "$STATUS_LINES"
} > "$STATUS_FILE" 2>/dev/null || true

exit 0
