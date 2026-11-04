#!/bin/bash
# 小抄的拓展 · 微端恢复脚本（macOS）
# 删除微端插件 app 目录并还原官方 app.asar，等于把微端恢复到官方原版。
# 注意：小抄微端插件也会一起被移除，需要时请重新安装插件，再安装拓展。
# 用法：sudo bash restore.sh [微端的 Resources 目录]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
LOG_FILE="$ROOT/restore.log"

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
    echo '如果微端装在非默认位置，可执行：sudo bash restore.sh "微端的 Resources 目录"'
    exit 1
fi
RESOURCES="$(cd "$RESOURCES" && pwd)"

if pgrep -x SGSOL >/dev/null 2>&1; then
    log '错误：三国杀微端正在运行，请先完全退出。'
    exit 1
fi

if [ ! -w "$RESOURCES" ]; then
    log '错误：没有写入权限，请执行：sudo bash restore.sh'
    exit 1
fi

log '开始恢复官方微端'
rm -rf "$RESOURCES/.xc-ext-install" "$RESOURCES/.xc-ext-rollback"

if [ -d "$RESOURCES/app" ]; then
    log '正在删除微端插件 app 目录…'
    rm -rf "$RESOURCES/app"
fi
if [ -d "$RESOURCES/app" ]; then
    log '错误：无法删除 app 目录，可能仍被占用。'
    exit 1
fi

if [ -f "$RESOURCES/app.asar.bak" ]; then
    log '正在还原官方 app.asar…'
    mv "$RESOURCES/app.asar.bak" "$RESOURCES/app.asar"
elif [ ! -f "$RESOURCES/app.asar" ]; then
    log '警告：既没有 app.asar.bak，也没有 app.asar，微端可能无法启动。请重新安装官方微端。'
fi

if [ -d "$RESOURCES/xc-ext" ]; then
    rm -rf "$RESOURCES/xc-ext"
    log '已移除拓展文件（Resources/xc-ext）。'
fi

log '恢复完成：已回到官方微端。小抄微端插件也已移除，需要时请重新安装。'
