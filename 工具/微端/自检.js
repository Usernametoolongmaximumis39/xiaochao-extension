#!/usr/bin/env node
/*
 * 微端补丁自检：验证 apply-patch.ps1 / apply-patch.sh 打出来的补丁可用、幂等，
 * 并模拟 preload 注入、main 进程 IPC、Windows/macOS 更新器插桩。
 *
 * 用法：
 *   node 工具/微端/自检.js <解压后的小抄微端 app 目录>
 *
 * app 目录获取方式：到 https://xiaochao.org/download/weiduan/xiaochao-latest.zip
 * 下载微端插件，解压后把 app.zip 再解压，得到 app/ 目录（里面应有 main.js、script/electron_renderer.js）。
 * 自检只读取这个目录，复制到系统临时目录里打补丁，不会修改原目录。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const TOOL_DIR = __dirname;
const PATCH_PS1 = path.join(TOOL_DIR, '模板', 'apply-patch.ps1');
const PATCH_SH = path.join(TOOL_DIR, '模板', 'apply-patch.sh');

let failures = 0;
function check(name, fn) {
    try {
        const result = fn();
        if (result === false) throw new Error('断言返回 false');
        console.log('  ✔ ' + name);
    } catch (error) {
        failures++;
        console.error('  ✘ ' + name + '\n    ' + (error && error.stack || error));
    }
}

function hashFiles(dir, names) {
    return names.map((name) => {
        const file = path.join(dir, name);
        return name + ':' + require('crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    }).join('|');
}

function extractBlock(file, marker) {
    const text = fs.readFileSync(file, 'utf8');
    const index = text.indexOf(marker);
    if (index < 0) throw new Error('找不到标记：' + marker + ' @ ' + file);
    const start = text.lastIndexOf(';/*', index);
    return text.slice(start);
}

function main() {
    const sourceApp = process.argv[2];
    if (!sourceApp || !fs.existsSync(path.join(sourceApp, 'main.js'))) {
        console.error('用法：node 工具/微端/自检.js <解压后的小抄微端 app 目录>');
        process.exit(2);
    }
    const extensionFile = (() => {
        const root = path.resolve(TOOL_DIR, '..', '..');
        const names = fs.readdirSync(root)
            .map((name) => ({ name, match: name.match(/^小抄的拓展-(\d+\.\d+\.\d+)\.js$/) }))
            .filter((item) => item.match)
            .sort((a, b) => b.match[1].localeCompare(a.match[1], undefined, { numeric: true }));
        if (!names.length) throw new Error('找不到拓展脚本');
        return path.join(root, names[0].name);
    })();
    const extensionSource = fs.readFileSync(extensionFile, 'utf8');

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xc-ext-selftest-'));
    const resources = path.join(tempRoot, 'resources');
    const appDir = path.join(resources, 'app');
    fs.mkdirSync(path.join(resources, 'xc-ext'), { recursive: true });
    fs.cpSync(sourceApp, appDir, { recursive: true });
    fs.copyFileSync(extensionFile, path.join(resources, 'xc-ext', 'xc-ext.js'));

    const isWindows = process.platform === 'win32';
    const patchScript = isWindows ? path.join(tempRoot, 'apply-patch.ps1') : PATCH_SH;
    if (isWindows) {
        // 与生成器一致：带 BOM，Windows PowerShell 5.1 才会按 UTF-8 解析
        fs.writeFileSync(patchScript, '﻿' + fs.readFileSync(PATCH_PS1, 'utf8'), 'utf8');
    }
    const tracked = ['main.js', 'script/electron_renderer.js', 'micro-client-updater.js'];

    function runPatch() {
        let result;
        if (isWindows) {
            const ps = path.join(process.env.SystemRoot || 'C:\\Windows',
                'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
            result = spawnSync(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
                '-File', patchScript, '-AppDir', appDir, '-ResourcesDir', resources], { encoding: 'utf8' });
        } else {
            result = spawnSync('bash', [patchScript, appDir, resources], { encoding: 'utf8' });
        }
        if (result.status !== 0) {
            throw new Error('补丁脚本失败（exit ' + result.status + '）：\n' + result.stdout + '\n' + result.stderr);
        }
        return (result.stdout || '') + (result.stderr || '');
    }

    try {
        console.log('补丁：' + path.relative(TOOL_DIR, patchScript));
        const firstRun = runPatch();
        console.log(firstRun.trim().split('\n').map((line) => '  ' + line).join('\n'));

        check('main.js / electron_renderer.js 已注入', () => {
            const mainText = fs.readFileSync(path.join(appDir, 'main.js'), 'utf8');
            const rendererText = fs.readFileSync(path.join(appDir, 'script/electron_renderer.js'), 'utf8');
            if (!mainText.includes('==XC-EXT-IPC==')) throw new Error('main.js 缺少 IPC 标记');
            if (!rendererText.includes('==XC-EXT-INJECT==')) throw new Error('renderer 缺少注入标记');
        });

        check('标记只出现一次（不会重复注入）', () => {
            const mainText = fs.readFileSync(path.join(appDir, 'main.js'), 'utf8');
            const rendererText = fs.readFileSync(path.join(appDir, 'script/electron_renderer.js'), 'utf8');
            const count = (text, needle) => text.split(needle).length - 1;
            if (count(mainText, '==XC-EXT-IPC==') !== 1) throw new Error('main.js IPC 标记数量异常');
            if (count(mainText, '==XC-EXT-PATCH==') !== 1) throw new Error('main.js 更新器标记数量异常');
            if (count(rendererText, '==XC-EXT-INJECT==') !== 1) throw new Error('renderer 标记数量异常');
        });

        check('重复执行补丁后文件不再变化（幂等）', () => {
            const before = hashFiles(appDir, tracked);
            runPatch();
            const after = hashFiles(appDir, tracked);
            if (before !== after) throw new Error('第二次执行改动了文件');
        });

        check('补丁后的 JS 语法正确（node --check）', () => {
            for (const name of tracked) {
                const result = spawnSync(process.execPath, ['--check', path.join(appDir, name)], { encoding: 'utf8' });
                if (result.status !== 0) throw new Error(name + ' 语法错误：\n' + result.stderr);
            }
        });

        check('Windows 更新器解压后会先调用 apply-patch', () => {
            const updater = require(path.join(appDir, 'micro-client-updater.js'));
            const built = updater.buildWindowsMicroClientUpdater({
                parentPid: 1,
                archivePath: path.join(tempRoot, 'update/app.zip'),
                resourcesPath: resources,
                executablePath: path.join(tempRoot, 'SGSOL.exe'),
                updaterPath: path.join(tempRoot, 'update/apply-update.ps1'),
                launcherPath: path.join(tempRoot, 'update/launch-update.ps1'),
                statusPath: path.join(tempRoot, 'update/update-status.txt')
            });
            const archive = built.updaterSource.indexOf('Expand-Archive -LiteralPath $Archive');
            const hook = built.updaterSource.indexOf('xc-ext/apply-patch.ps1');
            if (archive < 0 || hook < 0 || hook < archive) throw new Error('更新器里没有在解压后插入补丁调用');
            if ((built.updaterSource.match(/==XC-EXT-PATCH==/g) || []).length !== 1) throw new Error('更新器补丁标记数量异常');
        });

        check('macOS 更新器模板里插入补丁调用', () => {
            const mainText = fs.readFileSync(path.join(appDir, 'main.js'), 'utf8');
            const hook = mainText.indexOf('bash "$RESOURCES/xc-ext/apply-patch.sh"');
            const anchor = mainText.indexOf('if [ ! -f "$NEW_APP/package.json" ]; then');
            if (hook < 0 || anchor < 0 || hook > anchor) throw new Error('macOS 更新器未正确插桩');
        });

        check('main 进程 IPC 能返回拓展源码', () => {
            const block = extractBlock(path.join(appDir, 'main.js'), '==XC-EXT-IPC==');
            const listeners = {};
            const context = {
                require: (id) => {
                    if (id === 'electron') return { ipcMain: { on: (channel, handler) => { listeners[channel] = handler; } } };
                    return require(id);
                },
                process: { resourcesPath: resources },
                __dirname: appDir,
                console
            };
            vm.runInNewContext(block, context);
            if (!listeners['xc-ext-source']) throw new Error('没有注册 xc-ext-source');
            const event = {};
            listeners['xc-ext-source'](event);
            if (!event.returnValue || !event.returnValue.ok) throw new Error('IPC 返回失败：' + JSON.stringify(event.returnValue));
            if (event.returnValue.code !== extensionSource) throw new Error('IPC 返回的源码与拓展脚本不一致');
            if (!event.returnValue.version) throw new Error('IPC 未返回版本号');
        });

        check('webview preload 注入调用 webFrame.executeJavaScript', () => {
            const block = extractBlock(path.join(appDir, 'script/electron_renderer.js'), '==XC-EXT-INJECT==');
            const calls = [];
            const context = {
                ipcRenderer: { sendSync: () => ({ ok: true, version: '0.0.0-test', code: '/* ext */ void 0;' }) },
                webFrame: { executeJavaScript: (code) => { calls.push(code); return Promise.resolve(); } },
                window: {},
                console
            };
            vm.runInNewContext(block, context);
            if (calls.length !== 1 || calls[0] !== '/* ext */ void 0;') throw new Error('注入调用异常：' + JSON.stringify(calls));
        });

        check('preload 在拿不到拓展源码时只报错、不抛异常', () => {
            const block = extractBlock(path.join(appDir, 'script/electron_renderer.js'), '==XC-EXT-INJECT==');
            const errors = [];
            const context = {
                ipcRenderer: { sendSync: () => ({ ok: false, error: 'missing' }) },
                webFrame: { executeJavaScript: () => { throw new Error('不应调用'); } },
                window: {},
                console: { error: (...args) => errors.push(args.join(' ')), log: () => {} }
            };
            vm.runInNewContext(block, context);
            if (!errors.length) throw new Error('没有输出错误日志');
        });
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }

    if (failures) {
        console.error('\n自检失败：' + failures + ' 项');
        process.exit(1);
    }
    console.log('\n自检通过。');
}

main();
