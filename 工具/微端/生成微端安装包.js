#!/usr/bin/env node
/*
 * 生成「小抄的拓展」微端安装包。
 *
 * 用法：
 *   node 工具/微端/生成微端安装包.js
 *
 * 产物：
 *   工具/微端/输出/小抄拓展-微端安装包-<版本>/   （可直接使用的文件）
 *   工具/微端/输出/小抄拓展-微端安装包-<版本>.zip
 *
 * 安装包不包含、不修改 xiaochao.org 的小抄脚本或微端插件；
 * 它只把当前仓库里的拓展脚本和补丁脚本打成一个可在微端 resources 目录运行的安装器。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const TOOL_DIR = __dirname;
const REPO_ROOT = path.resolve(TOOL_DIR, '..', '..');
const TEMPLATE_DIR = path.join(TOOL_DIR, '模板');
const OUTPUT_ROOT = path.join(TOOL_DIR, '输出');

function fail(message) {
    console.error('生成失败：' + message);
    process.exit(1);
}

function readText(file) {
    return fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
}

function toCrlf(text) {
    return text.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
}

function cmpVersion(a, b) {
    const pa = String(a).split('.').map(Number);
    const pb = String(b).split('.').map(Number);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
        const x = pa[i] || 0;
        const y = pb[i] || 0;
        if (x > y) return 1;
        if (x < y) return -1;
    }
    return 0;
}

function findExtension() {
    const entries = fs.readdirSync(REPO_ROOT);
    const found = [];
    for (const name of entries) {
        const match = name.match(/^小抄的拓展-(\d+\.\d+\.\d+)\.js$/);
        if (match) found.push({ name, version: match[1] });
    }
    if (!found.length) fail('在仓库根目录找不到 小抄的拓展-<版本>.js');
    found.sort((a, b) => cmpVersion(b.version, a.version));
    const latest = found[0];
    const file = path.join(REPO_ROOT, latest.name);
    const text = readText(file);
    const versionMatch = text.match(/\/\/\s*@version\s+([\d.]+)/);
    if (!versionMatch) fail(latest.name + ' 头部没有 @version');
    if (versionMatch[1] !== latest.version) {
        fail('文件名版本 ' + latest.version + ' 与 @version ' + versionMatch[1] + ' 不一致');
    }
    const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (check.status !== 0) {
        fail(latest.name + ' 语法检查失败：\n' + (check.stderr || ''));
    }
    return { file, name: latest.name, version: latest.version };
}

// ---- 最小 ZIP 写入（store，UTF-8 文件名），不依赖外部工具 ----
const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(buffer) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buffer.length; i++) {
        crc = CRC_TABLE[(crc ^ buffer[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(date) {
    const time = ((date.getHours() & 0x1F) << 11) | ((date.getMinutes() & 0x3F) << 5) | ((date.getSeconds() >> 1) & 0x1F);
    const day = (((date.getFullYear() - 1980) & 0x7F) << 9) | (((date.getMonth() + 1) & 0x0F) << 5) | (date.getDate() & 0x1F);
    return { time, day };
}

function buildZip(files) {
    const now = new Date();
    const { time: dosTime, day: dosDate } = dosDateTime(now);
    const locals = [];
    const centrals = [];
    let offset = 0;

    for (const file of files) {
        const nameBuf = Buffer.from(file.name.replace(/\\/g, '/'), 'utf8');
        const data = file.data;
        const crc = crc32(data);

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);          // version needed
        local.writeUInt16LE(0x0800, 6);      // UTF-8 文件名
        local.writeUInt16LE(0, 8);           // store
        local.writeUInt16LE(dosTime, 10);
        local.writeUInt16LE(dosDate, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(data.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(nameBuf.length, 26);
        local.writeUInt16LE(0, 28);
        locals.push(local, nameBuf, data);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);        // made by
        central.writeUInt16LE(20, 6);        // version needed
        central.writeUInt16LE(0x0800, 8);
        central.writeUInt16LE(0, 10);
        central.writeUInt16LE(dosTime, 12);
        central.writeUInt16LE(dosDate, 14);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(data.length, 20);
        central.writeUInt32LE(data.length, 24);
        central.writeUInt16LE(nameBuf.length, 28);
        central.writeUInt16LE(0, 30);        // extra
        central.writeUInt16LE(0, 32);        // comment
        central.writeUInt16LE(0, 34);        // disk
        central.writeUInt16LE(0, 36);        // internal attrs
        central.writeUInt32LE(/\.sh$/.test(file.name) ? ((0o755 << 16) >>> 0) : 0, 38);
        central.writeUInt32LE(offset, 42);
        centrals.push(central, nameBuf);

        offset += local.length + nameBuf.length + data.length;
    }

    const centralBuf = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(files.length, 8);
    end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(centralBuf.length, 12);
    end.writeUInt32LE(offset, 16);
    end.writeUInt16LE(0, 20);
    return Buffer.concat([Buffer.concat(locals), centralBuf, end]);
}

function collectFiles(root) {
    const files = [];
    (function walk(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.isFile()) {
                files.push({
                    name: path.relative(root, full).replace(/\\/g, '/'),
                    data: fs.readFileSync(full)
                });
            }
        }
    })(root);
    files.sort((a, b) => a.name.localeCompare(b.name));
    return files;
}

function main() {
    const extension = findExtension();
    const version = extension.version;
    const packageName = '小抄拓展-微端安装包-' + version;
    const outDir = path.join(OUTPUT_ROOT, packageName);

    console.log('拓展脚本：' + extension.name + '（v' + version + '）');
    console.log('输出目录：' + path.relative(REPO_ROOT, outDir));

    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(outDir, 'xc-ext'), { recursive: true });

    const template = (name) => readText(path.join(TEMPLATE_DIR, name));

    // install.bat / restore.bat：批处理头 + 以 UTF-8 读取自身后执行的 PowerShell 正文
    const installBat = toCrlf(template('install.bat.head') + template('install.ps1'));
    const restoreBat = toCrlf(template('restore.bat.head') + template('restore.ps1'));
    fs.writeFileSync(path.join(outDir, 'install.bat'), installBat, 'utf8');
    fs.writeFileSync(path.join(outDir, 'restore.bat'), restoreBat, 'utf8');

    fs.writeFileSync(path.join(outDir, 'install.sh'), template('install.sh'), 'utf8');
    fs.writeFileSync(path.join(outDir, 'restore.sh'), template('restore.sh'), 'utf8');
    fs.writeFileSync(
        path.join(outDir, '安装说明.txt'),
        template('安装说明.txt').replace(/\{\{VERSION\}\}/g, version),
        'utf8'
    );

    // apply-patch.ps1 加 UTF-8 BOM，Windows PowerShell 5.1 才会按 UTF-8 解析中文
    fs.writeFileSync(
        path.join(outDir, 'xc-ext', 'apply-patch.ps1'),
        '﻿' + template('apply-patch.ps1'),
        'utf8'
    );
    fs.writeFileSync(path.join(outDir, 'xc-ext', 'apply-patch.sh'), template('apply-patch.sh'), 'utf8');
    fs.copyFileSync(extension.file, path.join(outDir, 'xc-ext', 'xc-ext.js'));
    fs.copyFileSync(path.join(REPO_ROOT, 'LICENSE'), path.join(outDir, 'LICENSE'));

    const zipPath = path.join(OUTPUT_ROOT, packageName + '.zip');
    fs.writeFileSync(zipPath, buildZip(collectFiles(outDir)));

    const files = collectFiles(outDir);
    console.log('已生成：');
    for (const file of files) {
        console.log('  ' + file.name + '  (' + file.data.length + ' bytes)');
    }
    console.log('压缩包：' + path.relative(REPO_ROOT, zipPath) + ' (' + fs.statSync(zipPath).size + ' bytes)');
}

main();
