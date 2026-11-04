/**
 * 小抄 iPad 页面版 · 自动更新镜像（Cloudflare Worker 单文件）
 *
 * 作用：每次被请求时读取官方最新版本 → 下载官方小抄 → 只改用户脚本头部：
 *   - 删除 @grant / @sandbox / @updateURL / @downloadURL；
 *   - 加入 @grant none（让 Safari 油猴把脚本放进页面主环境）；
 *   - 把 @updateURL / @downloadURL 指回本 Worker 自己；
 *   - @name 改为「小抄（iPad 页面版）」；
 * 正文一个字节都不改（返回前用 SHA-256 校验）。
 *
 * 部署后，在 Stay 里用本 Worker 的 URL 安装一次，并打开该脚本的「自动更新」；
 * 以后官方小抄更新，Stay 会从本 Worker 拉到最新的补丁版，不需要再手动移植。
 *
 * 部署：Cloudflare Dashboard → Workers & Pages → Create → Worker → 粘贴本文件 → Deploy。
 * 访问 https://<你的子域>.workers.dev/xiaochao-ipad.user.js 即为脚本。
 */

const CONFIG_URL = 'https://xiaochao.org/api/config';
const DOWNLOAD_BASE = 'https://xiaochao.org/download/%E5%B0%8F%E6%8A%84.user.js';
const MARKER = '// ==/UserScript==';
const IPAD_NAME = '小抄（iPad 页面版）';

function bytesToHex(buf) {
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return bytesToHex(buf);
}

function extractVersion(header) {
    const m = header.match(/^\/\/[ \t]*@version[ \t]+(\S+)[ \t]*$/m);
    return m ? m[1] : '';
}

function patchHeader(header, selfUrl) {
    const eol = header.includes('\r\n') ? '\r\n' : '\n';
    const lines = header.split(/\r?\n/);
    const out = [];
    let inserted = false;
    let nameDone = false;
    const note = '// @note         由「小抄的拓展」iPad 自动更新镜像生成：只改授权指令，正文与官方原版一致。';

    function insert() {
        if (inserted) return;
        out.push('// @grant        none');
        out.push('// @updateURL    ' + selfUrl);
        out.push('// @downloadURL  ' + selfUrl);
        out.push(note);
        inserted = true;
    }

    for (const line of lines) {
        const t = line.trim();
        if (/^\/\/[ \t]*@grant\b/.test(t)) continue;
        if (/^\/\/[ \t]*@sandbox\b/.test(t)) continue;
        if (/^\/\/[ \t]*@updateURL\b/.test(t)) continue;
        if (/^\/\/[ \t]*@downloadURL\b/.test(t)) continue;
        if (/^\/\/[ \t]*@name\b/.test(t)) {
            out.push('// @name         ' + IPAD_NAME);
            nameDone = true;
            continue;
        }
        if (/^\/\/[ \t]*@run-at\b/.test(t)) insert();
        out.push(line);
    }
    insert();
    if (!nameDone) out.splice(1, 0, '// @name         ' + IPAD_NAME);
    while (out.length && out[out.length - 1] === '') out.pop();
    return out.join(eol) + eol;
}

async function suiteFetch(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    try {
        return await fetch(url, { signal: ctrl.signal, cf: { cacheTtl: 300 } });
    } finally {
        clearTimeout(timer);
    }
}

async function buildPayload(selfUrl) {
    const cfgRes = await suiteFetch(CONFIG_URL);
    if (!cfgRes.ok) throw new Error('config HTTP ' + cfgRes.status);
    const cfg = await cfgRes.json();
    const version = String(cfg.scriptVersion || cfg.version || cfg.latestVersion || '');
    const download = cfg.scriptUrl || (DOWNLOAD_BASE + '?v=' + encodeURIComponent(version));
    if (!version) throw new Error('config 里没有版本号');

    // 同一个 Worker URL + 版本只下载/打补丁一次
    const cache = caches.default;
    const cacheKey = new Request(selfUrl + '?v=' + encodeURIComponent(version));
    const hit = await cache.match(cacheKey);
    if (hit) {
        const payload = await hit.text();
        return { version, payload, fromCache: true };
    }

    const upRes = await suiteFetch(download);
    if (!upRes.ok) throw new Error('download HTTP ' + upRes.status);
    const text = await upRes.text();
    const markerIdx = text.indexOf(MARKER);
    if (markerIdx < 0) throw new Error('官方文件里找不到 ' + MARKER);

    const header = text.slice(0, markerIdx);
    const body = text.slice(markerIdx + MARKER.length);
    const officialVersion = extractVersion(header);
    if (!officialVersion) throw new Error('官方文件头部没有 @version');

    const newHeader = patchHeader(header, selfUrl);
    const payload = newHeader + MARKER + body;

    // 正文必须与官方逐字节一致
    const outIdx = payload.indexOf(MARKER);
    const outBody = payload.slice(outIdx + MARKER.length);
    const before = await sha256(body);
    const after = await sha256(outBody);
    if (before !== after) throw new Error('正文校验失败');

    await cache.put(cacheKey, new Response(payload, {
        headers: {
            'content-type': 'text/plain; charset=utf-8',
            'x-xiaochao-version': officialVersion,
            'x-xiaochao-body-sha256': before
        }
    }));
    return { version: officialVersion, payload, fromCache: false };
}

export { patchHeader, extractVersion };
export default {
    async fetch(request) {
        const url = new URL(request.url);
        const selfUrl = url.origin + url.pathname;
        const cors = {
            'access-control-allow-origin': '*',
            'access-control-allow-methods': 'GET, HEAD, OPTIONS',
            'cache-control': 'no-cache'
        };

        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: cors });
        }

        try {
            const { version, payload, fromCache } = await buildPayload(selfUrl);
            if (url.searchParams.get('meta') === '1') {
                return new Response(JSON.stringify({
                    version,
                    fromCache,
                    bytes: payload.length,
                    selfUrl
                }, null, 2), {
                    headers: { ...cors, 'content-type': 'application/json; charset=utf-8' }
                });
            }
            return new Response(payload, {
                headers: {
                    ...cors,
                    'content-type': 'text/javascript; charset=utf-8',
                    'x-xiaochao-version': version,
                    'x-xiaochao-from-cache': fromCache ? '1' : '0'
                }
            });
        } catch (e) {
            // 失败时不要返回半截脚本；Stay 会保留旧版本
            return new Response('// xiaochao-ipad 镜像错误：' + (e && e.message ? e.message : e) + '\n',
                { status: 502, headers: { ...cors, 'content-type': 'text/javascript; charset=utf-8' } });
        }
    }
};
