#!/usr/bin/env node
'use strict';

/**
 * 生成「小抄 iPad 页面版」：以 原版小抄/小抄-<版本>.js 为源，只改用户脚本头部授权指令，
 * 让 Safari 油猴把脚本放进页面主环境（与「小抄的拓展」同一个世界），正文保持逐字节一致。
 *
 * 用法：
 *   node 工具/生成iPad页面版小抄.js                 # 自动选 原版小抄/ 里版本号最大的
 *   node 工具/生成iPad页面版小抄.js 原版小抄/小抄-1.6.66.js
 *
 * 规则（见 iPad使用说明.md / AGENTS.md 3.3）：
 *   - @name 改为「小抄（iPad 页面版）」；
 *   - 删除所有 @grant / @sandbox / @downloadURL / @updateURL；
 *   - 在 @run-at 前插入 @grant none 与一行 @note；
 *   - 正文（// ==/UserScript== 之后）一个字节都不动，生成后用 sha256 校验。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ORIG_DIR = path.join(ROOT, '原版小抄');
const MARKER = '// ==/UserScript==';
const NAME_IPAD = '小抄（iPad 页面版）';

function die(msg) {
    console.error('✗ ' + msg);
    process.exit(1);
}

function sha256(buf) {
    return crypto.createHash('sha256').update(buf).digest('hex');
}

function cmpVersionDesc(a, b) {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const x = pa[i] || 0, y = pb[i] || 0;
        if (x !== y) return y - x;
    }
    return 0;
}

function findLatestOriginal() {
    if (!fs.existsSync(ORIG_DIR)) die('找不到目录：' + ORIG_DIR);
    const files = fs.readdirSync(ORIG_DIR)
        .filter(f => /^小抄-\d+(\.\d+)+\.js$/.test(f))
        .map(f => ({ f, v: f.replace(/^小抄-/, '').replace(/\.js$/, '') }));
    if (!files.length) die('原版小抄/ 里没有 小抄-<版本>.js，请先按 AGENTS.md 3.1 下载');
    files.sort((a, b) => cmpVersionDesc(a.v, b.v));
    return path.join(ORIG_DIR, files[0].f);
}

function patchHeader(headerText) {
    const eol = headerText.includes('\r\n') ? '\r\n' : '\n';
    const lines = headerText.split(/\r?\n/);
    const out = [];
    let inserted = false;
    let nameReplaced = false;
    const note = '// @note         本文件由「小抄的拓展」项目生成：只把授权指令改为 @grant none，' +
        '让脚本在 Safari 油猴的页面主环境运行（与拓展一致）；正文与原版完全一致。';

    function insertGrant() {
        if (inserted) return;
        out.push('// @grant        none');
        out.push(note);
        inserted = true;
    }

    for (const line of lines) {
        const t = line.trim();
        if (/^\/\/[ \t]*@grant\b/.test(t)) continue;          // 所有 GM 授权都去掉
        if (/^\/\/[ \t]*@sandbox\b/.test(t)) continue;        // Safari 油猴不认
        if (/^\/\/[ \t]*@downloadURL\b/.test(t)) continue;    // 防止自动更新把授权改回去
        if (/^\/\/[ \t]*@updateURL\b/.test(t)) continue;
        if (/^\/\/[ \t]*@name\b/.test(t)) {
            out.push('// @name         ' + NAME_IPAD);
            nameReplaced = true;
            continue;
        }
        if (/^\/\/[ \t]*@run-at\b/.test(t)) insertGrant();
        out.push(line);
    }
    insertGrant();

    if (!nameReplaced) out.splice(1, 0, '// @name         ' + NAME_IPAD);

    // 去掉插入后可能产生的多余空行（只压头部末尾，不动正文）
    while (out.length && out[out.length - 1] === '') out.pop();
    return out.join(eol) + eol;
}

function extractVersion(headerText) {
    const m = headerText.match(/^\/\/\s*@version\s+(\S+)\s*$/m);
    return m ? m[1] : '';
}

function checkHeader(headerText) {
    if (/^\/\/[ \t]*@sandbox\b/m.test(headerText)) die('生成结果头部检查失败：仍含 @sandbox');
    if (/^\/\/[ \t]*@downloadURL\b/m.test(headerText)) die('生成结果头部检查失败：仍含 @downloadURL');
    if (/^\/\/[ \t]*@updateURL\b/m.test(headerText)) die('生成结果头部检查失败：仍含 @updateURL');
    const grants = Array.from(headerText.matchAll(/^\/\/[ \t]*@grant[ \t]+(\S+)[ \t]*$/mg))
        .map(m => m[1]);
    if (grants.length !== 1 || grants[0] !== 'none') {
        die('生成结果头部检查失败：应当恰好有一个 @grant none，实际为 ' + JSON.stringify(grants));
    }
}

function main() {
    const srcPath = process.argv[2] ? path.resolve(process.argv[2]) : findLatestOriginal();
    if (!fs.existsSync(srcPath)) die('源文件不存在：' + srcPath);

    const srcText = fs.readFileSync(srcPath).toString('utf8');
    const markerIdx = srcText.indexOf(MARKER);
    if (markerIdx < 0) die('源文件里找不到 ' + MARKER + '，不是有效的油猴脚本');

    const headerText = srcText.slice(0, markerIdx);                 // 不含结束标记
    const bodyText = srcText.slice(markerIdx + MARKER.length);      // 含标记后的换行与正文
    const bodyHashSrc = sha256(Buffer.from(bodyText, 'utf8'));

    const version = extractVersion(headerText);
    if (!version) die('源文件头部没有 @version');

    const newHeader = patchHeader(headerText);
    checkHeader(newHeader);

    const outText = newHeader + MARKER + bodyText;
    const outMarkerIdx = outText.indexOf(MARKER);
    const outBodyText = outText.slice(outMarkerIdx + MARKER.length);
    if (sha256(Buffer.from(outBodyText, 'utf8')) !== bodyHashSrc) {
        die('正文校验失败：生成文件的正文与源文件不一致');
    }

    const outPath = path.join(ROOT, '小抄-' + version + '-iPad页面版.user.js');

    // 旧版本的派生文件可以随时重新生成，直接清掉，避免仓库里堆 2MB 文件
    for (const f of fs.readdirSync(ROOT)) {
        if (/^小抄-\d+(\.\d+)+-iPad页面版\.user\.js$/.test(f) && path.join(ROOT, f) !== outPath) {
            fs.unlinkSync(path.join(ROOT, f));
            console.log('· 删除旧派生文件：' + f);
        }
    }

    fs.writeFileSync(outPath, Buffer.from(outText, 'utf8'));

    const check = spawnSync(process.execPath, ['--check', outPath], { encoding: 'utf8' });
    if (check.status !== 0) {
        try { fs.unlinkSync(outPath); } catch (e) {}
        die('node --check 未通过：\n' + (check.stderr || check.stdout));
    }

    console.log('✓ 已生成：' + path.relative(ROOT, outPath));
    console.log('  源文件：' + path.relative(ROOT, srcPath) + '（@version ' + version + '）');
    console.log('  正文 sha256（源/生成相同）：' + bodyHashSrc);
    console.log('  大小：' + fs.statSync(outPath).size + ' bytes');
    console.log('');
    console.log('下一步：在 iPad 油猴里停用旧版，重新导入这个文件（正文与原版一致，仅头部授权不同）。');
}

main();
