#!/bin/bash
# 小抄的拓展 · 微端安装器（macOS）
# 前置：官方三国杀微端已安装「小抄微端插件」（Resources/app 存在）。
# 用法：cd 到本安装包目录，执行 sudo bash install.sh
#      微端不在默认位置时：sudo bash install.sh /Applications/SGSOL.app/Contents/Resources
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
LOG_FILE="$ROOT/install.log"

log() {
    local message="[$(date '+%Y-%m-%d %H:%M:%S')] $1"
    printf '%s\n' "$message"
    printf '%s\n' "$message" >> "$LOG_FILE" 2>/dev/null || true
}

resolve_resources() {
    if [ -n "${XC_RESOURCES:-}" ]; then
        printf '%s' "$XC_RESOURCES"
        return 0
    fi
    if [ -n "${1:-}" ]; then
        printf '%s' "$1"
        return 0
    fi
    if [ "$(basename "$ROOT")" = "Resources" ]; then
        printf '%s' "$ROOT"
        return 0
    fi
    if [ -d "/Applications/SGSOL.app/Contents/Resources" ]; then
        printf '%s' "/Applications/SGSOL.app/Contents/Resources"
        return 0
    fi
    printf ''
}

RESOURCES="$(resolve_resources "${1:-}")"
if [ -z "$RESOURCES" ] || [ ! -d "$RESOURCES" ]; then
    log '错误：未找到三国杀微端的 Resources 目录。'
    echo '请先安装官方三国杀微端和 xiaochao.org 的「微端插件」；'
    echo '如果微端装在非默认位置，可执行：sudo bash install.sh "微端的 Resources 目录"'
    exit 1
fi
RESOURCES="$(cd "$RESOURCES" && pwd)"

APP_DIR="$RESOURCES/app"
STAGE="$RESOURCES/.xc-ext-install"
BACKUP="$RESOURCES/.xc-ext-rollback"
PAYLOAD="$ROOT/xc-ext"
DEST="$RESOURCES/xc-ext"

MARK_IPC='==XC-EXT-IPC=='
MARK_INJECT='==XC-EXT-INJECT=='

for relative in package.json main.js xiaochao.js script/electron_renderer.js; do
    if [ ! -f "$APP_DIR/$relative" ]; then
        log "错误：$RESOURCES/app 里缺少 $relative，当前安装可能不是小抄微端插件。"
        echo '请先按 xiaochao.org 的说明安装「微端插件」，完全退出微端后再运行本安装器。'
        exit 1
    fi
done

if [ ! -f "$PAYLOAD/xc-ext.js" ] || [ ! -f "$PAYLOAD/apply-patch.sh" ]; then
    log '错误：安装包不完整，缺少 xc-ext/xc-ext.js 或 xc-ext/apply-patch.sh。'
    exit 1
fi

if [ ! -w "$RESOURCES" ]; then
    log '错误：没有写入权限，请执行：sudo bash install.sh'
    exit 1
fi

if pgrep -x SGSOL >/dev/null 2>&1; then
    log '错误：三国杀微端仍在运行，请先完全退出。'
    exit 1
fi

EXT_VERSION="$(sed -n 's/^\/\/ @version[[:space:]]*//p' "$PAYLOAD/xc-ext.js" | head -n 1 | tr -d ' \r')"
[ -n "$EXT_VERSION" ] || EXT_VERSION='未知'
CLIENT_VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$APP_DIR/package.json" | head -n 1)"
[ -n "$CLIENT_VERSION" ] || CLIENT_VERSION='未知'

log "检测到小抄微端插件 v$CLIENT_VERSION，准备安装拓展 v$EXT_VERSION。"

mkdir -p "$DEST"
cp -f "$PAYLOAD"/* "$DEST"/

rm -rf "$STAGE" "$BACKUP"
mkdir "$STAGE"
STAGED_APP="$STAGE/app"

cleanup_failed() {
    if [ ! -d "$APP_DIR" ] && [ -d "$BACKUP" ]; then
        mv "$BACKUP" "$APP_DIR" 2>/dev/null || true
    fi
    rm -rf "$STAGE" "$BACKUP"
}

trap 'cleanup_failed' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

log '正在复制并打补丁，现有安装保持不变。'
cp -R "$APP_DIR" "$STAGED_APP"
bash "$ROOT/xc-ext/apply-patch.sh" "$STAGED_APP" "$RESOURCES"

if ! grep -q "$MARK_IPC" "$STAGED_APP/main.js" || ! grep -q "$MARK_INJECT" "$STAGED_APP/script/electron_renderer.js"; then
    log '错误：补丁校验失败（main.js 或 electron_renderer.js 未注入）。'
    exit 1
fi

if pgrep -x SGSOL >/dev/null 2>&1; then
    log '错误：三国杀微端在安装过程中被打开了，请完全退出后重试。'
    exit 1
fi

log '校验通过，正在替换 app 目录；旧文件保留到安装成功。'
mv "$APP_DIR" "$BACKUP"
if ! mv "$STAGED_APP" "$APP_DIR"; then
    log '错误：替换 app 目录失败，正在恢复旧安装。'
    mv "$BACKUP" "$APP_DIR" 2>/dev/null || true
    exit 1
fi
rm -rf "$BACKUP" "$STAGE"
trap - EXIT INT TERM

{
    printf '拓展版本：%s\n' "$EXT_VERSION"
    printf '小抄微端插件版本：%s\n' "$CLIENT_VERSION"
    printf '安装时间：%s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
    printf 'Resources：%s\n' "$RESOURCES"
} > "$DEST/installed.txt" 2>/dev/null || true

log "安装成功：小抄的拓展 v$EXT_VERSION 已注入微端。"
echo '重新打开三国杀微端即可生效。'
echo '小抄微端插件自动更新时会自动重新打补丁，拓展不会丢失。'
echo '更新拓展：下载新版安装包后重新运行 install.sh 即可（设置与缓存都会保留）。'
