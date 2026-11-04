// ==UserScript==
// @name         小抄的拓展
// @version      2.6.6
// @description  小抄的拓展：拦截并阻止小抄脚本与 *.xiaochao.org 的所有网络通信（含 fetch / XHR / Worker / sendBeacon / Image / WebSocket / EventSource / window.open）；接管小抄 HUD 的“检测更新”按钮，并给“跳转被屏蔽”提示条补上关闭叉；「秒杀连点」面板支持自动购买所选物品；「盖主速刷」（盖主（小号）/ 反贼（大号）/ 点将（百胜））挂在「小抄 → 配置 → 游戏辅助」；官服 95 折充值；支持 iPad / 隔离世界油猴（移动端默认内置小抄），以及配合小抄微端插件在官方三国杀微端里运行（见 微端使用说明.md）。逐版本变更记录见 更新日志.md。
// @author       -
// @match        *://game.4399iw2.com/yxsgs/*
// @match        *://my.4399.com/yxsgs/*
// @match        *://*.sanguosha.com/*
// @match        *://web.sanguosha.com/*
// @match        *://web.kuaiwan.com/kwsgsn/*
// @match        *://wan.baidu.com/microend?gameId=19793595*
// @match        *://www.7k7k.com/special/sgs/?*
// @match        *://playgame.iqiyi.com/login/iframe_page_web/top?game_id=146
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const TAG = '[BlockXiaochao]';
    const FAKE_BODY = JSON.stringify({ ok: false, error: 'blocked' });

    console.log(TAG, '脚本开始执行, 页面:', location.href);

    // ============ 0.0 保存原生引用（必须在安装屏蔽钩子之前） ============
    // 这些引用用于本脚本自己的“检测更新”请求，绕过下面安装的拦截器。
    const NATIVE = {
        fetch: typeof window.fetch === 'function' ? window.fetch.bind(window) : null,
        XHR: window.XMLHttpRequest,
        Worker: window.Worker,
        open: typeof window.open === 'function' ? window.open : null
    };

    // 触屏设备（iPad / 手机）。2.6 起的移动端专属行为都以此为准。
    // 注意不能只看 'ontouchstart' in window：带触摸屏的 Windows 笔记本也会命中，
    // 它们仍然算 PC（不弹下载窗、不显示支付跳转）。优先看移动端 UA，
    // 再看「多点触控 + 粗指针」（iPadOS 桌面 UA 也满足）。
    function xcIsTouchDevice() {
        try {
            var ua = String((typeof navigator !== 'undefined' && navigator.userAgent) || '');
            // Windows / Linux / ChromeOS 一律按 PC 处理（带触摸屏的笔记本也不要弹移动端 UI）
            if (/(Windows|Win32|Win64|WOW64|Linux|CrOS)/i.test(ua) && !/Android/i.test(ua)) return false;
            if (/iPad|iPhone|iPod|Android|Mobile/i.test(ua)) return true;
            var mt = (typeof navigator !== 'undefined' && navigator.maxTouchPoints) || 0;
            // iPadOS 13+ 的 Safari 默认报桌面 UA（Macintosh），靠触控点数区分
            if (mt > 1 && /Macintosh/i.test(ua)) return true;
            if (mt > 0) {
                try {
                    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return true;
                } catch (e) {}
            }
        } catch (e) {}
        return false;
    }

    // ============ 0.0.1 触屏：点按补发鼠标悬浮事件 ============
    // 原版小抄 / 游戏里有不少信息只有鼠标悬浮才出现（物品、战功、好友、更换同名武将…）。
    // iPad 上手指点按只有 touch/click，这里在点按位置补发一组 mouseover/mouseenter/mousemove，
    // 让这些悬浮层也能通过单击打开；几秒后自动补 mouseout/mouseleave 收起。
    var xcTouchHover = (function () {
        var installed = false;
        var hoverTimer = 0;
        var last = null;
        var moved = false;
        var multi = false;

        function mouseEvt(type, x, y, bubbles) {
            try {
                return new MouseEvent(type, {
                    bubbles: !!bubbles,
                    cancelable: false,
                    view: window,
                    clientX: x,
                    clientY: y,
                    screenX: x,
                    screenY: y,
                    button: 0,
                    buttons: 0
                });
            } catch (e) {
                try {
                    var ev = document.createEvent('MouseEvents');
                    ev.initMouseEvent(type, !!bubbles, false, window, 0, x, y, x, y,
                        false, false, false, false, 0, null);
                    return ev;
                } catch (e2) { return null; }
            }
        }

        function fire(el, type, x, y, bubbles) {
            var ev = mouseEvt(type, x, y, bubbles);
            if (!ev || !el || typeof el.dispatchEvent !== 'function') return;
            try { el.dispatchEvent(ev); } catch (e) {}
        }

        function clearLast() {
            if (!last) return;
            var el = last.el, x = last.x, y = last.y;
            last = null;
            fire(el, 'mouseout', x, y, true);
            var n = el, guard = 0;
            while (n && guard++ < 40) {
                fire(n, 'mouseleave', x, y, false);
                n = n.parentNode;
            }
        }

        function hoverAt(target, x, y) {
            if (!target || target.nodeType !== 1) {
                target = (target && target.parentElement) || null;
            }
            if (!target) return;
            clearLast();
            if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = 0; }
            // mouseover 会冒泡；mouseenter 不冒泡，所以逐级补发
            fire(target, 'mouseover', x, y, true);
            var n = target, guard = 0;
            while (n && guard++ < 40) {
                fire(n, 'mouseenter', x, y, false);
                n = n.parentNode;
            }
            fire(target, 'mousemove', x, y, true);
            setTimeout(function () { fire(target, 'mousemove', x, y, true); }, 60);
            last = { el: target, x: x, y: y };
            hoverTimer = setTimeout(function () {
                hoverTimer = 0;
                clearLast();
            }, 4500);
        }

        function install() {
            if (installed || !xcIsTouchDevice()) return;
            installed = true;
            document.addEventListener('touchstart', function (e) {
                moved = false;
                multi = !!(e.touches && e.touches.length > 1);
            }, true);
            document.addEventListener('touchmove', function () { moved = true; }, true);
            document.addEventListener('touchcancel', function () {
                moved = false;
                multi = false;
            }, true);
            document.addEventListener('touchend', function (e) {
                if (moved || multi) { moved = false; multi = false; return; }
                var t = e.changedTouches && e.changedTouches[0];
                if (!t) return;
                var x = t.clientX, y = t.clientY;
                // 让原生 click 先发生，再补悬浮事件，避免悬浮层抢走点击
                setTimeout(function () {
                    var el = null;
                    try { el = document.elementFromPoint(x, y); } catch (e2) { el = null; }
                    hoverAt(el || e.target, x, y);
                }, 30);
            }, true);
        }

        return { install: install, hoverAt: hoverAt };
    })();

    // ============ 0.0.2 触屏：禁止把小抄 HUD 拖到最右侧变成侧边栏 ============
    // 原版 HUD 的拖拽手柄（.Mz7qyvmoTzn）在松手点距屏幕右缘 <25px 时会进入侧边栏模式；
    // 移动端误拖很容易触发，之后 HUD 被压成 250px 竖条、布局异常。
    // 这里在捕获阶段把「靠右的移动/松手」夹到距右缘 31px 处再交给原版，
    // 保留正常拖动，但永远不会触发侧边栏。
    var xcHudDockGuard = (function () {
        var installed = false;
        var dragging = false;
        var pointerId = null;

        function nearEdgeX() {
            try {
                var w = (document.documentElement && document.documentElement.clientWidth) || window.innerWidth || 0;
                return Math.max(0, w - 31);
            } catch (e) { return 0; }
        }
        function isDragHandle(target) {
            try {
                return !!(target && target.closest && target.closest('.Mz7qyvmoTzn'));
            } catch (e) { return false; }
        }
        function clonePointer(type, original, x, y, buttons) {
            try {
                return new PointerEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    composed: true,
                    pointerId: original.pointerId,
                    pointerType: original.pointerType || 'touch',
                    isPrimary: original.isPrimary !== false,
                    clientX: x,
                    clientY: y,
                    screenX: x,
                    screenY: y,
                    button: 0,
                    buttons: buttons
                });
            } catch (e) { return null; }
        }
        function swallow(e) {
            try { e.stopPropagation(); } catch (e2) {}
            try { if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation(); } catch (e2) {}
        }

        function install() {
            if (installed || !xcIsTouchDevice() || typeof window.PointerEvent !== 'function') return;
            installed = true;
            // 拖拽提示条（「拖到这里变为侧边栏」）在移动端直接不显示
            try {
                var style = document.createElement('style');
                style.id = 'xcExtHudDockGuardStyle';
                style.textContent = '#EfuDe3{display:none!important;pointer-events:none!important}';
                (document.head || document.documentElement).appendChild(style);
            } catch (e) {}
            document.addEventListener('pointerdown', function (e) {
                if (!isDragHandle(e.target)) return;
                if (typeof e.button === 'number' && e.button !== 0) return;
                dragging = true;
                pointerId = e.pointerId;
            }, true);
            document.addEventListener('pointermove', function (e) {
                if (!dragging || e.pointerId !== pointerId) return;
                var limit = nearEdgeX();
                if (e.clientX <= limit) return;
                swallow(e);
                var ev = clonePointer('pointermove', e, limit, e.clientY, 1);
                if (ev) { try { (e.target || document).dispatchEvent(ev); } catch (e2) {} }
            }, true);
            document.addEventListener('pointerup', function (e) {
                if (!dragging || e.pointerId !== pointerId) return;
                var limit = nearEdgeX();
                var near = e.clientX > limit;
                dragging = false;
                pointerId = null;
                if (!near) return;
                swallow(e);
                // dragging 已清空，我们自己的捕获监听不会再次拦截这个合成事件
                var ev = clonePointer('pointerup', e, limit, e.clientY, 0);
                if (ev) { try { (e.target || document).dispatchEvent(ev); } catch (e2) {} }
            }, true);
            document.addEventListener('pointercancel', function () {
                dragging = false;
                pointerId = null;
            }, true);
        }
        return { install: install };
    })();

    // ============ 0.0.3 触屏：百胜战功按钮尽早接管 ============
    // 盖主速刷工厂里的面板可能在页面主环境注入完成前还没 boot；这里在页面脚本一启动
    // 就用 window.__xcExtBaiShengOpen 这个桥接打开拓展面板。拿不到桥接（隔离世界）时
    // 不拦截，交给页面主环境里那份 gaizhu 自己的捕获监听。
    var xcBaiShengOuterInstalled = false;
    function xcInstallBaiShengOuterHook() {
        if (xcBaiShengOuterInstalled || !xcIsTouchDevice()) return;
        xcBaiShengOuterInstalled = true;
        document.addEventListener('click', function (e) {
            var btn = null;
            try {
                btn = e.target && e.target.closest ? e.target.closest('#NgC2OfZaC,button') : null;
            } catch (e2) { btn = null; }
            if (!btn) return;
            if (btn.id !== 'NgC2OfZaC' && String(btn.textContent || '').trim() !== '百胜战功') return;
            // 隔离世界不要把事件截走：页面主环境里注入的那份 gaizhu 才读得到 Laya/AchievementManager
            try {
                if (typeof XC_PAGE_STATE !== 'undefined' && XC_PAGE_STATE.world === 'isolated') return;
            } catch (eWorld) {}
            var open = null;
            try { open = window.__xcExtBaiShengOpen; } catch (e3) { open = null; }
            if (typeof open !== 'function') return;
            try {
                e.preventDefault();
                e.stopPropagation();
                if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
            } catch (e4) {}
            try { open(); } catch (e5) {}
        }, true);
    }

    // ============ 0. 工具函数 ============
    function isXiaochaoUrl(url) {
        try {
            if (url == null) return false;
            const s = String(url);
            // 相对路径直接跳过
            if (!/^https?:|^\/\//i.test(s) && !s.startsWith('http')) {
                // 用 base 解析相对路径
                try {
                    const u = new URL(s, location.href);
                    const host = u.hostname.toLowerCase();
                    return host === 'xiaochao.org' || host.endsWith('.xiaochao.org');
                } catch (e) {
                    return false;
                }
            }
            const u = new URL(s, location.href);
            const host = u.hostname.toLowerCase();
            return host === 'xiaochao.org' || host.endsWith('.xiaochao.org');
        } catch (e) {
            return false;
        }
    }

    function makeFakeResponse() {
        try {
            return new Response(FAKE_BODY, {
                status: 200,
                statusText: 'OK',
                headers: { 'Content-Type': 'application/json' }
            });
        } catch (e) {
            // 极端旧环境 fallback
            const r = {
                ok: true, status: 200, statusText: 'OK',
                text: () => Promise.resolve(FAKE_BODY),
                json: () => Promise.resolve({ ok: false, error: 'blocked' })
            };
            return r;
        }
    }

    // ============ 1. 锁定 window.fetch ============
    function installFetchHook() {
        const current = window.fetch;
        if (current && /isXiaochaoUrl|BlockXiaochao/.test(current.toString())) {
            return; // 已经装过
        }
        const baseFetch = current;
        const hooked = function (input, init) {
            let url = '';
            try {
                if (typeof input === 'string') url = input;
                else if (input && typeof input.url === 'string') url = input.url;
            } catch (e) {}
            if (url && isXiaochaoUrl(url)) {
                console.debug(TAG, 'fetch 已拦截:', url);
                return Promise.resolve(makeFakeResponse());
            }
            return baseFetch.apply(this, arguments);
        };
        // 供「内置小抄」等本拓展自己的下载使用：拿到未被拦截的原生 fetch
        try { hooked.__xcBase = baseFetch; } catch (e) {}
        try {
            Object.defineProperty(window, 'fetch', {
                configurable: true,
                enumerable: true,
                writable: false,
                value: hooked
            });
        } catch (e) {
            try { window.fetch = hooked; } catch (e2) {}
        }
    }
    installFetchHook();

    // ============ 2. 锁定 XMLHttpRequest ============
    function installXhrHook() {
        const proto = XMLHttpRequest.prototype;
        if (proto.__blockXiaochaoInstalled) return;
        proto.__blockXiaochaoInstalled = true;

        const originalOpen = proto.open;
        const originalSend = proto.send;

        const hookedOpen = function (method, url) {
            try {
                this.__blockXiaochaoUrl = url;
                this.__blockXiaochaoBlocked = isXiaochaoUrl(url);
                if (this.__blockXiaochaoBlocked) {
                    console.debug(TAG, 'XHR.open 已拦截:', url);
                }
            } catch (e) {}
            return originalOpen.apply(this, arguments);
        };

        const hookedSend = function (body) {
            if (this.__blockXiaochaoBlocked) {
                const self = this;
                setTimeout(function () {
                    try {
                        Object.defineProperty(self, 'readyState', { value: 4, configurable: true });
                        Object.defineProperty(self, 'status', { value: 200, configurable: true });
                        Object.defineProperty(self, 'statusText', { value: 'OK', configurable: true });
                        Object.defineProperty(self, 'responseText', { value: FAKE_BODY, configurable: true });
                        Object.defineProperty(self, 'response', { value: FAKE_BODY, configurable: true });
                        Object.defineProperty(self, 'responseURL', {
                            value: String(self.__blockXiaochaoUrl || ''),
                            configurable: true
                        });
                        if (typeof self.onreadystatechange === 'function') self.onreadystatechange();
                        if (typeof self.onload === 'function') self.onload();
                        if (typeof self.onloadend === 'function') self.onloadend();
                    } catch (e) {
                        console.debug(TAG, '伪造 XHR 响应失败:', e);
                    }
                }, 0);
                return;
            }
            return originalSend.apply(this, arguments);
        };

        try {
            Object.defineProperty(proto, 'open', {
                configurable: true, enumerable: true, writable: false, value: hookedOpen
            });
            Object.defineProperty(proto, 'send', {
                configurable: true, enumerable: true, writable: false, value: hookedSend
            });
        } catch (e) {
            try { proto.open = hookedOpen; proto.send = hookedSend; } catch (e2) {}
        }
    }
    installXhrHook();

    // ============ 3. 拦截 Web Worker 内的 fetch ============
    function installWorkerHook() {
        const OriginalWorker = window.Worker;
        if (typeof OriginalWorker !== 'function') return;
        if (OriginalWorker.__blockXiaochaoInstalled) return;

        const HookedWorker = function (scriptURL, options) {
            const worker = new OriginalWorker(scriptURL, options);
            try {
                const originalPostMessage = worker.postMessage.bind(worker);
                worker.postMessage = function (message, transfer) {
                    try {
                        if (message && typeof message === 'object' && message.url) {
                            if (isXiaochaoUrl(message.url)) {
                                console.debug(TAG, 'Worker.postMessage 已拦截:', message.url);
                                setTimeout(function () {
                                    try {
                                        worker.dispatchEvent(new MessageEvent('message', {
                                            data: { id: message.id, networkError: 'BlockedByUserScript' }
                                        }));
                                    } catch (e) {}
                                }, 0);
                                return;
                            }
                        }
                    } catch (e) {}
                    return originalPostMessage(message, transfer);
                };
            } catch (e) {}
            return worker;
        };
        HookedWorker.prototype = OriginalWorker.prototype;
        try { Object.setPrototypeOf(HookedWorker, OriginalWorker); } catch (e) {}
        HookedWorker.__blockXiaochaoInstalled = true;
        try {
            Object.defineProperty(window, 'Worker', {
                configurable: true, enumerable: true, writable: false, value: HookedWorker
            });
        } catch (e) {
            try { window.Worker = HookedWorker; } catch (e2) {}
        }
    }
    installWorkerHook();

    // ============ 4. 拦截 sendBeacon ============
    function installBeaconHook() {
        if (!navigator.sendBeacon) return;
        if (navigator.sendBeacon.__blockXiaochaoInstalled) return;
        const original = navigator.sendBeacon.bind(navigator);
        const hooked = function (url, data) {
            if (isXiaochaoUrl(url)) {
                console.debug(TAG, 'sendBeacon 已拦截:', url);
                return true;
            }
            return original(url, data);
        };
        hooked.__blockXiaochaoInstalled = true;
        try {
            Object.defineProperty(navigator, 'sendBeacon', {
                configurable: true, enumerable: true, writable: false, value: hooked
            });
        } catch (e) {
            try { navigator.sendBeacon = hooked; } catch (e2) {}
        }
    }
    installBeaconHook();

    // ============ 5. 拦截 Image.src ============
    function installImageHook() {
        const OriginalImage = window.Image;
        if (typeof OriginalImage !== 'function') return;
        if (OriginalImage.__blockXiaochaoInstalled) return;

        const HookedImage = function (width, height) {
            const img = new OriginalImage(width, height);
            try {
                // 拦截 src 赋值
                const srcDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
                if (srcDesc && srcDesc.set) {
                    Object.defineProperty(img, 'src', {
                        configurable: true,
                        enumerable: true,
                        get() { return srcDesc.get.call(this); },
                        set(v) {
                            if (isXiaochaoUrl(v)) {
                                console.debug(TAG, 'Image.src 已拦截:', v);
                                return;
                            }
                            srcDesc.set.call(this, v);
                        }
                    });
                }
            } catch (e) {}
            return img;
        };
        HookedImage.prototype = OriginalImage.prototype;
        try { Object.setPrototypeOf(HookedImage, OriginalImage); } catch (e) {}
        HookedImage.__blockXiaochaoInstalled = true;
        try {
            Object.defineProperty(window, 'Image', {
                configurable: true, enumerable: true, writable: false, value: HookedImage
            });
        } catch (e) {
            try { window.Image = HookedImage; } catch (e2) {}
        }
    }
    installImageHook();

    // ============ 6. 拦截 WebSocket ============
    function installWebSocketHook() {
        const OriginalWS = window.WebSocket;
        if (typeof OriginalWS !== 'function') return;
        if (OriginalWS.__blockXiaochaoInstalled) return;

        const HookedWS = function (url, protocols) {
            if (isXiaochaoUrl(url)) {
                console.debug(TAG, 'WebSocket 已拦截:', url);
                const fake = Object.create(OriginalWS.prototype);
                fake.url = url;
                fake.readyState = 3;
                fake.send = function () {};
                fake.close = function () {};
                fake.addEventListener = function () {};
                fake.removeEventListener = function () {};
                return fake;
            }
            return new OriginalWS(url, protocols);
        };
        HookedWS.prototype = OriginalWS.prototype;
        try { Object.setPrototypeOf(HookedWS, OriginalWS); } catch (e) {}
        ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(function (k) {
            try { HookedWS[k] = OriginalWS[k]; } catch (e) {}
        });
        HookedWS.__blockXiaochaoInstalled = true;
        try {
            Object.defineProperty(window, 'WebSocket', {
                configurable: true, enumerable: true, writable: false, value: HookedWS
            });
        } catch (e) {
            try { window.WebSocket = HookedWS; } catch (e2) {}
        }
    }
    installWebSocketHook();

    // ============ 7. 拦截 EventSource ============
    function installEventSourceHook() {
        const OriginalES = window.EventSource;
        if (typeof OriginalES !== 'function') return;
        if (OriginalES.__blockXiaochaoInstalled) return;

        const HookedES = function (url, config) {
            if (isXiaochaoUrl(url)) {
                console.debug(TAG, 'EventSource 已拦截:', url);
                const fake = Object.create(OriginalES.prototype);
                fake.url = url;
                fake.readyState = 2;
                fake.close = function () {};
                fake.addEventListener = function () {};
                fake.removeEventListener = function () {};
                return fake;
            }
            return new OriginalES(url, config);
        };
        HookedES.prototype = OriginalES.prototype;
        try { Object.setPrototypeOf(HookedES, OriginalES); } catch (e) {}
        HookedES.__blockXiaochaoInstalled = true;
        try {
            Object.defineProperty(window, 'EventSource', {
                configurable: true, enumerable: true, writable: false, value: HookedES
            });
        } catch (e) {
            try { window.EventSource = HookedES; } catch (e2) {}
        }
    }
    installEventSourceHook();

    // ============ 8. 拦截 window.open（屏蔽跳转 xiaochao 页面） ============
    function installOpenHook() {
        const original = window.open;
        if (original.__blockXiaochaoInstalled) return;
        const hooked = function (url, name, features) {
            if (isXiaochaoUrl(url)) {
                console.debug(TAG, 'window.open 已拦截:', url);
                return null;
            }
            return original.apply(this, arguments);
        };
        hooked.__blockXiaochaoInstalled = true;
        try {
            Object.defineProperty(window, 'open', {
                configurable: true, enumerable: true, writable: false, value: hooked
            });
        } catch (e) {
            try { window.open = hooked; } catch (e2) {}
        }
    }
    installOpenHook();
    // 主环境哨兵：页面里注入的兼容脚本看到它就知道钩子已经装过了（同一世界才看得到）
    try { window.__xcExtPageHooks = 1; } catch (e) {}

    // ============ 0.5 iPad / 隔离世界兼容层 ============
    // iPad 上的油猴（Stay / Userscripts 等）在部分设置下把脚本注入「隔离世界」：
    //   · DOM 照常可读写，界面类功能没问题；
    //   · 但 window.fetch / XHR / Worker … 的改写只作用在隔离世界，页面里的小抄看不到；
    //   · window.Uc1cryZVg / VIiR0YfvE4s / Laya 这些页面变量也读不到，「盖主速刷」会完全失效。
    // 处理办法：往页面里插一段 <script>，让网络拦截在页面主环境再装一遍；确认是隔离世界后，
    // 再把「盖主速刷」整段注入页面主环境运行（它本身自包含，不依赖本文件的其它变量）。
    // 如果本来就运行在页面主环境（桌面 Chrome / Tampermonkey @grant none 等），
    // 注入的脚本只做一次探测就退出，不会重复挂钩子。
    // 运行状态见下方 XC_PAGE_STATE。

    // 这段函数会被 toString() 后塞进页面的 <script> 里，所以**不能引用外部任何变量**
    function xcPageWorldHooks(tag) {
        var W = window, D = document;
        function mark(state, extra) {
            try {
                if (D.documentElement) D.documentElement.setAttribute('data-xc-page', state + (extra ? '|' + extra : ''));
            } catch (e) {}
        }
        function boot() {
            // 确认框桥接两个世界都要装：主环境里它和秒杀模块自己的 confirm 钩子叠加也安全
            try {
                if (!W.__xcExtPageConfirm) {
                    W.__xcExtPageConfirm = 1;
                    var auto = false;
                    D.addEventListener('xc-ext-auto-confirm-on', function () { auto = true; }, true);
                    D.addEventListener('xc-ext-auto-confirm-off', function () { auto = false; }, true);
                    var oc = W.confirm;
                    if (typeof oc === 'function') {
                        var hc = function (msg) {
                            if (auto) return true;
                            return oc.apply(W, arguments);
                        };
                        // 继承秒杀模块打在原函数上的标记，避免它每 3 秒重复包一层
                        if (oc.__xcExtSeckillConfirm) hc.__xcExtSeckillConfirm = true;
                        try {
                            Object.defineProperty(W, 'confirm', {
                                configurable: true, enumerable: true, writable: true, value: hc
                            });
                        } catch (e) { try { W.confirm = hc; } catch (e2) {} }
                    }
                }
            } catch (e) {}
            // 主环境/隔离世界都要跑：原版小抄等的是 PC 客户端运行时接口，iPad 移动版缺几个
            try { scheduleLegacyShims(); } catch (e) {}
            // 记录页面错误 / 原版小抄自己的初始化失败提示，供自检卡片和复制诊断使用
            try { startErrorWatch(); } catch (e) {}
            if (W.__xcExtPageHooks) {
                try {
                    W.__xcExtPageInfo = { installed: true, uc: !!W.Uc1cryZVg, vi: !!W.VIiR0YfvE4s, laya: !!W.Laya };
                } catch (e) {}
                mark('exists');
                return;
            }
            W.__xcExtPageHooks = 1;
            var FAKE = '{"ok":false,"error":"blocked"}';
            function isXC(url) {
                try {
                    if (url == null) return false;
                    var u = new URL(String(url), location.href);
                    var h = String(u.hostname || '').toLowerCase();
                    return h === 'xiaochao.org' || h.slice(-13) === '.xiaochao.org';
                } catch (e) { return false; }
            }
            function fakeResponse() {
                try {
                    return new Response(FAKE, {
                        status: 200, statusText: 'OK',
                        headers: { 'Content-Type': 'application/json' }
                    });
                } catch (e) {
                    return {
                        ok: true, status: 200, statusText: 'OK',
                        text: function () { return Promise.resolve(FAKE); },
                        json: function () { return Promise.resolve({ ok: false, error: 'blocked' }); }
                    };
                }
            }
            var done = [];

            // fetch
            try {
                if (typeof W.fetch === 'function' && !W.fetch.__xcExtPageHooked) {
                    var baseFetch = W.fetch;
                    var hookedFetch = function (input, init) {
                        var url = '';
                        try {
                            if (typeof input === 'string') url = input;
                            else if (input && typeof input.url === 'string') url = input.url;
                        } catch (e) {}
                        if (url && isXC(url)) return Promise.resolve(fakeResponse());
                        return baseFetch.apply(this, arguments);
                    };
                    try {
                        Object.defineProperty(W, 'fetch', {
                            configurable: true, enumerable: true, writable: false, value: hookedFetch
                        });
                    } catch (e) { try { W.fetch = hookedFetch; } catch (e2) {} }
                    // 自我重装用它认「已经是我们包的 fetch」，别再按函数源码猜名字
                    hookedFetch.__xcExtPageHooked = true;
                    try { hookedFetch.__xcBase = baseFetch; } catch (e) {}
                    done.push('fetch');
                }
            } catch (e) {}

            // XMLHttpRequest
            try {
                var proto = W.XMLHttpRequest && W.XMLHttpRequest.prototype;
                if (proto && !proto.__blockXiaochaoInstalled) {
                    proto.__blockXiaochaoInstalled = true;
                    var oOpen = proto.open, oSend = proto.send;
                    var hOpen = function (method, url) {
                        try {
                            this.__xcBlockUrl = url;
                            this.__xcBlockHit = isXC(url);
                        } catch (e) {}
                        return oOpen.apply(this, arguments);
                    };
                    var hSend = function () {
                        if (this.__xcBlockHit) {
                            var self = this;
                            setTimeout(function () {
                                try {
                                    Object.defineProperty(self, 'readyState', { value: 4, configurable: true });
                                    Object.defineProperty(self, 'status', { value: 200, configurable: true });
                                    Object.defineProperty(self, 'statusText', { value: 'OK', configurable: true });
                                    Object.defineProperty(self, 'responseText', { value: FAKE, configurable: true });
                                    Object.defineProperty(self, 'response', { value: FAKE, configurable: true });
                                    Object.defineProperty(self, 'responseURL', {
                                        value: String(self.__xcBlockUrl || ''), configurable: true
                                    });
                                    if (typeof self.onreadystatechange === 'function') self.onreadystatechange();
                                    if (typeof self.onload === 'function') self.onload();
                                    if (typeof self.onloadend === 'function') self.onloadend();
                                } catch (e) {}
                            }, 0);
                            return;
                        }
                        return oSend.apply(this, arguments);
                    };
                    try {
                        Object.defineProperty(proto, 'open', {
                            configurable: true, enumerable: true, writable: false, value: hOpen
                        });
                        Object.defineProperty(proto, 'send', {
                            configurable: true, enumerable: true, writable: false, value: hSend
                        });
                    } catch (e) { try { proto.open = hOpen; proto.send = hSend; } catch (e2) {} }
                    done.push('xhr');
                }
            } catch (e) {}

            // Worker
            try {
                var OW = W.Worker;
                if (typeof OW === 'function' && !OW.__blockXiaochaoInstalled) {
                    var HW = function (scriptURL, options) {
                        var worker = new OW(scriptURL, options);
                        try {
                            var op = worker.postMessage.bind(worker);
                            worker.postMessage = function (message, transfer) {
                                try {
                                    if (message && typeof message === 'object' && message.url && isXC(message.url)) {
                                        setTimeout(function () {
                                            try {
                                                worker.dispatchEvent(new MessageEvent('message', {
                                                    data: { id: message.id, networkError: 'BlockedByUserScript' }
                                                }));
                                            } catch (e) {}
                                        }, 0);
                                        return;
                                    }
                                } catch (e) {}
                                return op(message, transfer);
                            };
                        } catch (e) {}
                        return worker;
                    };
                    HW.prototype = OW.prototype;
                    try { Object.setPrototypeOf(HW, OW); } catch (e) {}
                    HW.__blockXiaochaoInstalled = true;
                    try {
                        Object.defineProperty(W, 'Worker', {
                            configurable: true, enumerable: true, writable: false, value: HW
                        });
                    } catch (e) { try { W.Worker = HW; } catch (e2) {} }
                    done.push('worker');
                }
            } catch (e) {}

            // sendBeacon
            try {
                if (W.navigator && W.navigator.sendBeacon && !W.navigator.sendBeacon.__blockXiaochaoInstalled) {
                    var oBeacon = W.navigator.sendBeacon.bind(W.navigator);
                    var hBeacon = function (url, data) {
                        if (isXC(url)) return true;
                        return oBeacon(url, data);
                    };
                    hBeacon.__blockXiaochaoInstalled = true;
                    try {
                        Object.defineProperty(W.navigator, 'sendBeacon', {
                            configurable: true, enumerable: true, writable: false, value: hBeacon
                        });
                    } catch (e) { try { W.navigator.sendBeacon = hBeacon; } catch (e2) {} }
                    done.push('beacon');
                }
            } catch (e) {}

            // Image.src
            try {
                var OI = W.Image;
                if (typeof OI === 'function' && !OI.__blockXiaochaoInstalled) {
                    var HI = function (width, height) {
                        var img = new OI(width, height);
                        try {
                            var desc = Object.getOwnPropertyDescriptor(W.HTMLImageElement.prototype, 'src');
                            if (desc && desc.set) {
                                Object.defineProperty(img, 'src', {
                                    configurable: true, enumerable: true,
                                    get: function () { return desc.get.call(this); },
                                    set: function (v) {
                                        if (isXC(v)) return;
                                        desc.set.call(this, v);
                                    }
                                });
                            }
                        } catch (e) {}
                        return img;
                    };
                    HI.prototype = OI.prototype;
                    try { Object.setPrototypeOf(HI, OI); } catch (e) {}
                    HI.__blockXiaochaoInstalled = true;
                    try {
                        Object.defineProperty(W, 'Image', {
                            configurable: true, enumerable: true, writable: false, value: HI
                        });
                    } catch (e) { try { W.Image = HI; } catch (e2) {} }
                    done.push('image');
                }
            } catch (e) {}

            // WebSocket / EventSource
            [['WebSocket', 3], ['EventSource', 2]].forEach(function (spec) {
                try {
                    var O = W[spec[0]];
                    if (typeof O !== 'function' || O.__blockXiaochaoInstalled) return;
                    var H = function (url, opt) {
                        if (isXC(url)) {
                            var fake = Object.create(O.prototype);
                            fake.url = url;
                            fake.readyState = spec[1];
                            fake.send = function () {};
                            fake.close = function () {};
                            fake.addEventListener = function () {};
                            fake.removeEventListener = function () {};
                            return fake;
                        }
                        return new O(url, opt);
                    };
                    H.prototype = O.prototype;
                    try { Object.setPrototypeOf(H, O); } catch (e) {}
                    ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(function (k) {
                        try { H[k] = O[k]; } catch (e) {}
                    });
                    H.__blockXiaochaoInstalled = true;
                    try {
                        Object.defineProperty(W, spec[0], {
                            configurable: true, enumerable: true, writable: false, value: H
                        });
                    } catch (e) { try { W[spec[0]] = H; } catch (e2) {} }
                    done.push(spec[0].toLowerCase());
                } catch (e) {}
            });

            // window.open
            try {
                var oOpen = W.open;
                if (typeof oOpen === 'function' && !oOpen.__blockXiaochaoInstalled) {
                    var hOpenWin = function (url, name, features) {
                        if (isXC(url)) return null;
                        return oOpen.apply(this, arguments);
                    };
                    hOpenWin.__blockXiaochaoInstalled = true;
                    try {
                        Object.defineProperty(W, 'open', {
                            configurable: true, enumerable: true, writable: false, value: hOpenWin
                        });
                    } catch (e) { try { W.open = hOpenWin; } catch (e2) {} }
                    done.push('open');
                }
            } catch (e) {}

            try {
                W.__xcExtPageInfo = { installed: true, uc: !!W.Uc1cryZVg, vi: !!W.VIiR0YfvE4s, laya: !!W.Laya };
            } catch (e) {}
            mark('ok', done.join(','));
            // 页面里后加载的脚本可能把 fetch 顶掉，定期补装（只装一次心跳）
            try {
                if (!W.__xcExtPageTimer) {
                    W.__xcExtPageTimer = setInterval(function () {
                        try {
                            if (typeof W.fetch === 'function' && !W.fetch.__xcExtPageHooked) {
                                W.__xcExtPageHooks = 0;
                                boot();
                            }
                        } catch (e) {}
                    }, 3000);
                }
            } catch (e) {}

            // 原版小抄在 PC 客户端上等的是 #bgDiv + SystemContext + JSZipUtils + CtrUtil.Ctr.Ofb_Dec；
            // iPad 的移动版客户端缺其中几个时，会卡在「等待游戏运行时初始化超时」。
            // 这里只补缺失的那几个（真实接口存在时优先用真实的），让原版小抄有机会继续初始化。实验性。
            try { scheduleLegacyShims(); } catch (e) {}
        }

        function xcApplyLegacyShims() {
            try {
                var touch = false;
                try { touch = ('ontouchstart' in W) || !!(W.navigator && W.navigator.maxTouchPoints > 0); } catch (e) {}
                if (!touch) return false;
                var isGame = false;
                try {
                    isGame = !!(D.querySelector && D.querySelector('canvas')) ||
                        /\/h5\/|\/game\/|\/220\/|\/yxsgs\/|\/kwsgsn\//.test(String((W.location && W.location.pathname) || ''));
                } catch (e) {}
                if (!isGame) return false;
                if (W.__xcLegacyShimDone) return true;

                var added = [];
                if (typeof W.SystemContext === 'undefined') {
                    try {
                        W.SystemContext = {
                            gameWidth: W.innerWidth || 1024,
                            gameHeight: W.innerHeight || 768,
                            scale: 1
                        };
                        added.push('SystemContext');
                    } catch (e) {}
                }
                if (typeof W.JSZipUtils === 'undefined') {
                    try {
                        W.JSZipUtils = {
                            getBinaryContent: function (url, cb) {
                                try {
                                    var xhr = new W.XMLHttpRequest();
                                    xhr.open('GET', url, true);
                                    xhr.responseType = 'arraybuffer';
                                    xhr.onload = function () {
                                        try { cb(null, xhr.response); } catch (e) {}
                                    };
                                    xhr.onerror = function () {
                                        try { cb(new Error('iPad 兼容层：下载失败 ' + url), null); } catch (e) {}
                                    };
                                    xhr.send();
                                } catch (e) {
                                    try { cb(e, null); } catch (e2) {}
                                }
                            }
                        };
                        added.push('JSZipUtils');
                    } catch (e) {}
                }
                // 移动版客户端自己也有 CtrUtil（laya.core.min.js 里 class CtrUtil，全局词法声明），
                // 它的解密器 CtrUtil.Ctr 要靠 CtrUtil.Init() 加载 aesresc（Wasm）才有。
                // 小抄要的是真正的 CtrUtil.Ctr.Ofb_Dec —— 有真实类时优先用它，必要时帮它初始化。
                var realCtr = null;
                try { realCtr = (typeof CtrUtil !== 'undefined') ? CtrUtil : null; } catch (e) { realCtr = null; }
                var hasRealCtr = !!(realCtr && (typeof realCtr.Init === 'function' || realCtr === W.__xcRealCtr));
                if (hasRealCtr) {
                    try { W.__xcRealCtr = realCtr; W.CtrUtil = realCtr; } catch (e) {}
                    try {
                        if (!realCtr.Ctr && typeof realCtr.Init === 'function' &&
                            W.WebAssembly && !realCtr.__xcExtInitTried) {
                            realCtr.__xcExtInitTried = true;
                            realCtr.Init(function () {
                                try {
                                    if (D.documentElement) {
                                        D.documentElement.setAttribute('data-xc-ctr-ready',
                                            realCtr.Ctr && typeof realCtr.Ctr.Ofb_Dec !== 'undefined' ? '1' : '0');
                                    }
                                } catch (e) {}
                                try {
                                    console.log('[BlockXiaochao][iPad兼容] 已触发移动版 CtrUtil.Init()（Wasm 解密器）');
                                } catch (e) {}
                            });
                        }
                    } catch (e) {}
                }
                if (!hasRealCtr && typeof W.CtrUtil === 'undefined') {
                    try {
                        W.CtrUtil = { Ctr: { Ofb_Dec: function (v) { return v; } } };
                        added.push('CtrUtil');
                    } catch (e) {}
                } else if (!hasRealCtr) {
                    try {
                        if (W.CtrUtil && W.CtrUtil.Ctr && typeof W.CtrUtil.Ctr.Ofb_Dec === 'undefined') {
                            W.CtrUtil.Ctr.Ofb_Dec = function (v) { return v; };
                            added.push('CtrUtil.Ctr.Ofb_Dec');
                        }
                    } catch (e) {}
                }
                // #bgDiv：不往页面里塞节点，只在本世界拦截 getElementById；真实节点存在时优先返回真实的
                var hasRealBg = false;
                try { hasRealBg = !!D.getElementById('bgDiv'); } catch (e) {}
                if (!hasRealBg && !W.__xcBgShim) {
                    try {
                        W.__xcBgShim = 1;
                        var fakeBg = null;
                        var origGet = D.getElementById;
                        D.getElementById = function (id) {
                            var real = origGet.call(this, id);
                            if (real) return real;
                            if (String(id) === 'bgDiv') {
                                if (!fakeBg) {
                                    fakeBg = {
                                        id: 'bgDiv', style: {}, dataset: {}, firstElementChild: null,
                                        remove: function () {}, appendChild: function (n) { return n; }
                                    };
                                }
                                return fakeBg;
                            }
                            return real;
                        };
                        added.push('bgDiv');
                    } catch (e) {}
                }

                if (added.length) {
                    W.__xcLegacyShimDone = 1;
                    try { D.documentElement.setAttribute('data-xc-shim', added.join(',')); } catch (e) {}
                    try {
                        console.log('[BlockXiaochao][iPad兼容] 已补齐原版小抄等待的运行时接口：' +
                            added.join(', ') + '（实验性）');
                    } catch (e) {}
                    // 触发原版小抄的 MutationObserver 重新检查初始化条件
                    try {
                        var poke = D.createElement('span');
                        poke.setAttribute('data-xc-shim-poke', '1');
                        (D.body || D.documentElement).appendChild(poke);
                        setTimeout(function () {
                            try { if (poke.parentNode) poke.parentNode.removeChild(poke); } catch (e) {}
                        }, 0);
                    } catch (e) {}
                } else {
                    W.__xcLegacyShimDone = 1;
                }
                return true;
            } catch (e) { return false; }
        }

        function scheduleLegacyShims() {
            if (W.__xcShimScheduled) return;
            W.__xcShimScheduled = 1;
            var delays = [500, 1500, 3000, 6000, 10000, 20000, 40000];
            for (var i = 0; i < delays.length; i++) {
                (function (d) {
                    setTimeout(function () { xcApplyLegacyShims(); }, d);
                })(delays[i]);
            }
        }
        function startErrorWatch() {
            if (W.__xcErrorWatch) return;
            W.__xcErrorWatch = 1;
            var errs = [];
            // iPad/Safari 上游戏自身的背景音乐自动播放、屏幕常亮、剪贴板等会抛 NotAllowedError，
            // 这句提示很常见，别让它把小抄真正的初始化错误挤掉。
            var NOISE = /not allowed by the user agent|user denied permission|play\(\)|autoplay|wake ?lock|clipboard|storage access|安全策略|notallowed/i;
            function setAttr(name, value) {
                try {
                    if (D.documentElement) D.documentElement.setAttribute(name, String(value).slice(0, 1200));
                } catch (e) {}
            }
            function record(kind, text, stack) {
                try {
                    text = String(text == null ? '' : text).replace(/\s+/g, ' ').slice(0, 600);
                    if (!text) return;
                    stack = stack ? String(stack).replace(/\s+/g, ' ').slice(0, 900) : '';
                    var line = kind + ': ' + text;
                    if (errs[errs.length - 1] === line) return;
                    errs.push(line + (stack ? ' @ ' + stack : ''));
                    if (errs.length > 6) errs.shift();
                    W.__xcExtErrors = errs;
                    setAttr('data-xc-errors', errs.join('\n'));
                    if (NOISE.test(text)) {
                        setAttr('data-xc-last-noise', text.slice(0, 300));
                    } else {
                        setAttr('data-xc-last-error', text.slice(0, 300));
                        if (stack) setAttr('data-xc-last-stack', stack);
                    }
                } catch (e) {}
            }
            try {
                W.addEventListener('error', function (ev) {
                    record('页面错误',
                        (ev && (ev.message || (ev.error && ev.error.message))) || 'unknown error',
                        ev && ev.error && ev.error.stack);
                });
            } catch (e) {}
            try {
                W.addEventListener('unhandledrejection', function (ev) {
                    var r = ev && ev.reason;
                    record('未处理 Promise', r && (r.message || r.stack || String(r)), r && r.stack);
                });
            } catch (e) {}
            // 原版小抄初始化失败会弹一个 id 为 I9kxgXV2h2SO-init-error-tip 的提示框（内容里带阶段和错误）
            var n = 0;
            try {
                var iv = setInterval(function () {
                    n++;
                    try {
                        setAttr('data-xc-uc', W.Uc1cryZVg ? '1' : '0');
                        setAttr('data-xc-vi', W.VIiR0YfvE4s ? '1' : '0');
                    } catch (e) {}
                    try {
                        // 1.6.66 HUD 模板里的根节点 id/class：用它判断 HUD 是否曾经建出来过
                        var root = D.getElementById('V5EndqQ0xkd') ||
                            (D.querySelector && D.querySelector('.HxPQnVKW16Cv'));
                        setAttr('data-xc-hud-root', root ? '1' : '0');
                        if (root && !W.__xcHudSeen) {
                            W.__xcHudSeen = 1;
                            setAttr('data-xc-hud-seen', '1');
                        }
                    } catch (e) {}
                    try {
                        // 页面主环境里游戏自己声明的 CtrUtil（class 声明是全局词法绑定，不在 window 上）。
                        // 它的 Ctr（真正的小抄要用的解密器）要靠 CtrUtil.Init() 加载 aesresc（Wasm）才有；
                        // 移动版可能因为启动路径不同没初始化，这里帮它初始化一次。
                        var realCtr = null;
                        try { realCtr = (typeof CtrUtil !== 'undefined') ? CtrUtil : null; } catch (e) { realCtr = null; }
                        var isRealCtr = !!(realCtr && typeof realCtr.Init === 'function');
                        setAttr('data-xc-ctr-real', isRealCtr ? '1' : '0');
                        // 让只在 window.CtrUtil 上找的脚本也拿到真实的类（含 Ctr.Ofb_Dec）
                        if (isRealCtr) { try { W.CtrUtil = realCtr; } catch (e) {} }
                        var ctrReady = !!(isRealCtr && realCtr.Ctr && typeof realCtr.Ctr.Ofb_Dec !== 'undefined');
                        setAttr('data-xc-ctr-ready', ctrReady ? '1' : '0');
                        if (isRealCtr && !ctrReady && typeof realCtr.Init === 'function' &&
                            W.WebAssembly && !realCtr.__xcExtInitTried) {
                            realCtr.__xcExtInitTried = true;
                            realCtr.Init(function () {
                                try {
                                    setAttr('data-xc-ctr-ready',
                                        realCtr.Ctr && typeof realCtr.Ctr.Ofb_Dec !== 'undefined' ? '1' : '0');
                                    console.log('[BlockXiaochao][iPad兼容] 已触发 CtrUtil.Init()（Wasm 解密器）');
                                } catch (e) {}
                            });
                        }
                    } catch (e) {}
                    try {
                        // 小抄初始化要下载 Config_w.sgs（约 4MB）并初始化 aesresc（Wasm）
                        var pe = (W.performance && W.performance.getEntriesByType)
                            ? W.performance.getEntriesByType('resource') : [];
                        var hitConfig = false, hitAes = false;
                        for (var pi = 0; pi < pe.length; pi++) {
                            var pn = String(pe[pi].name || '');
                            if (pn.indexOf('Config_w.sgs') >= 0) hitConfig = true;
                            if (pn.indexOf('aesresc') >= 0) hitAes = true;
                        }
                        setAttr('data-xc-config-loaded', hitConfig ? '1' : '0');
                        setAttr('data-xc-aes-loaded', hitAes ? '1' : '0');
                    } catch (e) {}
                    try {
                        var tip = D.getElementById('I9kxgXV2h2SO-init-error-tip');
                        if (tip) {
                            var t = String(tip.textContent || '').replace(/\s+/g, ' ').trim();
                            if (t) record('小抄初始化提示', t.slice(0, 600));
                            setAttr('data-xc-xc-tip-seen', '1');
                        }
                    } catch (e) {}
                    if (n >= 90) { try { clearInterval(iv); } catch (e) {} }
                }, 1000);
            } catch (e) {}
            // 小抄自己出错时可能只打控制台；只收带小抄/初始化关键字的那几条
            ['error', 'warn'].forEach(function (k) {
                try {
                    var orig = W.console && W.console[k];
                    if (typeof orig !== 'function' || orig.__xcExtWrapped) return;
                    var wrapped = function () {
                        try {
                            var parts = [];
                            for (var i = 0; i < arguments.length; i++) {
                                var a = arguments[i];
                                parts.push(typeof a === 'string' ? a : (a && (a.message || a.stack)) || '');
                            }
                            var s = parts.join(' ');
                            if (/小抄|xcExt|初始化|init-error|runtime/i.test(s)) record('console.' + k, s);
                        } catch (e) {}
                        return orig.apply(W.console, arguments);
                    };
                    wrapped.__xcExtWrapped = 1;
                    W.console[k] = wrapped;
                } catch (e) {}
            });
        }

        try { boot(); } catch (e) { mark('error', (e && e.message) || String(e)); }
    }

    function xcPageAttr(name) {
        try { return document.documentElement ? document.documentElement.getAttribute(name) : null; }
        catch (e) { return null; }
    }

    function xcInjectIntoSamePage(source, kind) {
        var host = document.documentElement || document.head || document.body;
        if (!host) return false;
        try {
            var el = document.createElement('script');
            el.setAttribute('data-xc-ext', kind || '1');
            el.textContent = source;
            host.appendChild(el);
            setTimeout(function () {
                try { if (el.parentNode) el.parentNode.removeChild(el); } catch (e) {}
            }, 0);
            return true;
        } catch (e) { return false; }
    }

    function xcInjectViaBlob(source) {
        try {
            if (!window.Blob || !window.URL || typeof URL.createObjectURL !== 'function') return false;
            var host = document.documentElement || document.head || document.body;
            if (!host) return false;
            var url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
            var el = document.createElement('script');
            el.src = url;
            el.onload = el.onerror = function () {
                try { if (el.parentNode) el.parentNode.removeChild(el); } catch (e) {}
                try { URL.revokeObjectURL(url); } catch (e) {}
            };
            host.appendChild(el);
            return true;
        } catch (e) { return false; }
    }

    // 判定当前油猴跑在页面主环境还是隔离世界，并把钩子补进页面主环境。
    // 判定依据：注入的脚本执行后会在页面 window 上写 __xcExtPageInfo、在 <html> 上写 data-xc-page。
    // 两个都看不到 = 隔离世界；window 上能看到 = 同在主环境。
    var XC_PAGE_STATE = { world: null, hostWaits: 0, injectTries: 0, warned: false };

    function xcPageWorldGiveUp() {
        if (XC_PAGE_STATE.world !== null) return;
        XC_PAGE_STATE.world = 'unknown';
        if (!XC_PAGE_STATE.warned) {
            XC_PAGE_STATE.warned = true;
            console.warn(TAG, '[iPad兼容] 页面主环境注入没有生效（可能被 CSP 拦住）。' +
                '如果油猴本来就在页面主环境运行，可以忽略；如果通信拦截 / 盖主速刷不工作，' +
                '请把脚本切到「页面上下文 / MAIN world」再试');
        }
        // 有的环境注入是异步生效的：过几秒看到页面标记，再补一次盖主速刷注入
        setTimeout(function () {
            try {
                if (XC_PAGE_STATE.world === 'unknown' && !window.__xcExtPageInfo && xcPageAttr('data-xc-page')) {
                    XC_PAGE_STATE.world = 'isolated';
                    xcInjectPageGz();
                }
            } catch (e) {}
        }, 3000);
    }

    function xcEnsurePageWorld() {
        if (XC_PAGE_STATE.world !== null) return;
        if (window.__xcExtPageInfo) { XC_PAGE_STATE.world = 'page'; return; }
        var attr = xcPageAttr('data-xc-page');
        if (attr) { XC_PAGE_STATE.world = 'isolated'; xcInjectPageGz(); return; }
        var host = document.documentElement || document.head || document.body;
        if (!host) {
            if (XC_PAGE_STATE.hostWaits++ < 40) setTimeout(xcEnsurePageWorld, 100);
            else xcPageWorldGiveUp();
            return;
        }
        XC_PAGE_STATE.injectTries++;
        var src = '(' + xcPageWorldHooks.toString() + ')(' + JSON.stringify(TAG) + ');';
        // 内联脚本在浏览器里是同步执行的；连续两次没生效就当被 CSP 拦了，改用 blob 再试
        if (XC_PAGE_STATE.injectTries <= 2) xcInjectIntoSamePage(src, 'hooks');
        if (window.__xcExtPageInfo) { XC_PAGE_STATE.world = 'page'; return; }
        attr = xcPageAttr('data-xc-page');
        if (attr) { XC_PAGE_STATE.world = 'isolated'; xcInjectPageGz(); return; }
        if (XC_PAGE_STATE.injectTries <= 3) xcInjectViaBlob(src);
        if (XC_PAGE_STATE.injectTries < 8) setTimeout(xcEnsurePageWorld, 200);
        else xcPageWorldGiveUp();
    }

    // 隔离世界专用：把「盖主速刷」整段注入页面主环境（它依赖 window.Laya / 小抄内部变量）
    function xcInjectPageGz() {
        var st = xcPageAttr('data-xc-gz-inject');
        if (st === 'pending' || st === 'done') return;
        if (typeof xcGaiZhuInit !== 'function') { setTimeout(xcInjectPageGz, 80); return; }
        try { document.documentElement.setAttribute('data-xc-gz-inject', 'pending'); } catch (e) {}
        var src;
        try {
            src = '(function(){try{' +
                'if(window.__xcExtGzPage)return;' +
                'window.__xcExtGzPage=1;' +
                'var m=(' + xcGaiZhuInit.toString() + ')();' +
                'm.boot(true);' +
                'try{document.documentElement.setAttribute("data-xc-gz","1");}catch(e){}' +
                '}catch(e){' +
                'try{console.error("[BlockXiaochao][页面环境] 盖主速刷启动失败",e);}catch(e0){}' +
                'try{document.documentElement.setAttribute("data-xc-gz","err");}catch(e2){}' +
                '}})();';
        } catch (e) {
            console.warn(TAG, '[iPad兼容] 读取盖主速刷代码失败：', e);
            try { document.documentElement.setAttribute('data-xc-gz-inject', 'failed'); } catch (e2) {}
            return;
        }
        var ok = xcInjectIntoSamePage(src, 'gaizhu');
        if (!ok) xcInjectViaBlob(src);
        setTimeout(function () {
            var state = xcPageAttr('data-xc-gz');
            try {
                if (state === '1') {
                    document.documentElement.setAttribute('data-xc-gz-inject', 'done');
                    console.log(TAG, '[iPad兼容] 隔离世界里读不到页面变量：已在页面主环境启动一份「盖主速刷」');
                } else {
                    document.documentElement.setAttribute('data-xc-gz-inject', 'failed');
                    console.warn(TAG, '[iPad兼容] 隔离世界注入「盖主速刷」失败（页面 CSP / 油猴限制），' +
                        '它依赖的 Laya 与小抄变量在此环境读不到');
                }
            } catch (e) {}
        }, 2500);
    }

    // ============ 0.6 可选：内置小抄（从官方自动更新，不再依赖外部镜像） ============
    // iPad 上的油猴会把官方小抄放进沙箱（见 iPad使用说明.md），而 Cloudflare/其他镜像在
    // 国内经常访问不到。这里提供第三条路：由拓展自己从官方配置接口取最新版小抄，
    // 校验后缓存到 Cache API，并在 document-start 注入页面主环境运行。
    // 2.6 起：移动端默认启用；PC 默认关闭，必须在自检卡片上明确点「启用内置小抄」并确认后才会下载/执行官方脚本。
    // 开启后每次打开游戏都会检查官方版本：有新版就后台下载缓存，刷新后自动生效。
    const EMBED_FLAG_KEY = 'xcExt:embeddedXiaochao';
    const EMBED_AUTO_KEY = 'xcExt:embeddedAutoUpdate';
    const EMBED_VER_KEY = 'xcExt:embeddedXiaochaoVersion';
    const EMBED_CACHE_NAME = 'xcExtXiaochao';
    const EMBED_CACHE_URL = 'https://xc-ext.local/xiaochao.js';
    const EMBED_MODAL_ID = 'xcExtEmbedModal';
    const XC_CONFIG_URL = 'https://xiaochao.org/api/config';
    const XC_DOWNLOAD_BASE = 'https://xiaochao.org/download/%E5%B0%8F%E6%8A%84.user.js';
    const XC_OFFICIAL_LOGIN_URL = 'https://web.sanguosha.com/login/air/client/h5/index?v=1';
    var xcEmbedState = { enabled: false, auto: true, cached: '', latest: '', injected: '', error: '', downloading: false };

    function xcEmbedAttr(name, value) {
        try {
            if (document.documentElement) document.documentElement.setAttribute(name, String(value).slice(0, 160));
        } catch (e) {}
    }
    function xcEmbedFlag() {
        try {
            var v = localStorage.getItem(EMBED_FLAG_KEY);
            if (v === '1') return true;
            if (v === '0') return false;
        } catch (e) {}
        // 移动端（iPad / 手机）默认启用：装一个拓展，首次打开游戏就提示下载官方小抄。
        // PC 保持 2.5 的行为（默认关闭，只能从自检卡片手动启用）。
        return xcIsTouchDevice();
    }
    function xcEmbedAutoFlag() {
        try {
            var v = localStorage.getItem(EMBED_AUTO_KEY);
            if (v === '1') return true;
            if (v === '0') return false;
        } catch (e) {}
        // 移动端默认自动检查；PC 默认不动（用户长按开启后才在后台检查并提示）
        return xcIsTouchDevice();
    }
    function xcEmbedSetAutoFlag(on) {
        try { localStorage.setItem(EMBED_AUTO_KEY, on ? '1' : '0'); } catch (e) {}
        xcEmbedState.auto = !!on;
    }
    function xcEmbedSetFlag(on) {
        try { localStorage.setItem(EMBED_FLAG_KEY, on ? '1' : '0'); } catch (e) {}
        xcEmbedState.enabled = !!on;
        xcEmbedAttr('data-xc-embed', on ? 'on' : 'off');
    }
    function xcEmbedGetVer() {
        try { return localStorage.getItem(EMBED_VER_KEY) || ''; } catch (e) { return ''; }
    }
    function xcEmbedSetVer(v) {
        try { localStorage.setItem(EMBED_VER_KEY, String(v || '')); } catch (e) {}
        xcEmbedState.cached = String(v || '');
        xcEmbedAttr('data-xc-embed-version', String(v || ''));
    }
    function xcEmbedValid(src) {
        if (typeof src !== 'string' || src.length < 500000) return false;
        var s = src.replace(/^\s+/, '');   // \s 覆盖 BOM/空白
        return s.indexOf('// ==UserScript==') === 0 &&
            /@version[ \t]+\S+/.test(s.slice(0, 4000)) &&
            /SCRIPT_VERSION=/.test(s);
    }
    function xcEmbedSourceVersion(src) {
        var m = String(src || '').match(/^\/\/[ \t]*@version[ \t]+(\S+)/m);
        return m ? m[1] : '';
    }
    function xcEmbedNativeFetch() {
        try {
            if (NATIVE.fetch) return NATIVE.fetch;
            var f = window.fetch;
            if (f && typeof f.__xcBase === 'function') return f.__xcBase;
            return (typeof f === 'function') ? f.bind(window) : null;
        } catch (e) { return null; }
    }
    function xcEmbedConfig() {
        var nf = xcEmbedNativeFetch();
        if (!nf) return Promise.reject(new Error('fetch 不可用'));
        return nf(XC_CONFIG_URL, {
            method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer'
        }).then(function (r) {
            if (!r.ok) throw new Error('config HTTP ' + r.status);
            return r.json();
        }).then(function (cfg) {
            var ver = String(cfg.scriptVersion || cfg.version || cfg.latestVersion || '');
            var url = cfg.scriptUrl || (XC_DOWNLOAD_BASE + '?v=' + encodeURIComponent(ver));
            if (!ver) throw new Error('官方配置里没有版本号');
            return { version: ver, url: url };
        });
    }
    function xcEmbedDownload() {
        return xcEmbedConfig().then(function (cfg) {
            var nf = xcEmbedNativeFetch();
            if (!nf) throw new Error('fetch 不可用');
            return nf(cfg.url, {
                method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer'
            }).then(function (r) {
                if (!r.ok) throw new Error('download HTTP ' + r.status);
                return r.text();
            }).then(function (src) {
                if (!xcEmbedValid(src)) throw new Error('下载内容不是有效的小抄脚本');
                var sv = xcEmbedSourceVersion(src);
                if (cfg.version && sv && sv !== cfg.version) {
                    throw new Error('版本不一致：期望 ' + cfg.version + '，下载到 ' + sv);
                }
                return { version: cfg.version, source: src, url: cfg.url };
            });
        });
    }
    function xcEmbedCacheGet() {
        try {
            if (!window.caches) return Promise.resolve('');
            return caches.open(EMBED_CACHE_NAME)
                .then(function (c) { return c.match(EMBED_CACHE_URL); })
                .then(function (r) { return r ? r.text() : ''; })
                .catch(function () { return ''; });
        } catch (e) { return Promise.resolve(''); }
    }
    function xcEmbedCachePut(src, ver) {
        try {
            if (!window.caches) return Promise.resolve(false);
            return caches.open(EMBED_CACHE_NAME).then(function (c) {
                return c.put(new Request(EMBED_CACHE_URL), new Response(src, {
                    headers: { 'x-xc-version': String(ver || '') }
                }));
            }).then(function () { return true; }).catch(function () { return false; });
        } catch (e) { return Promise.resolve(false); }
    }
    function xcEmbedInject(src, ver) {
        if (!xcEmbedValid(src)) {
            xcEmbedState.error = '缓存内容无效';
            return false;
        }
        try {
            if (window.Uc1cryZVg || window.VIiR0YfvE4s) {
                xcEmbedState.error = '已检测到页面里的小抄在运行，跳过内置注入';
                xcEmbedAttr('data-xc-embed', 'skip-installed');
                return false;
            }
        } catch (e) {}
        var ok = xcInjectIntoSamePage(src, 'xiaochao');
        if (ok) {
            xcEmbedState.injected = String(ver || '');
            xcEmbedAttr('data-xc-embed', 'injected');
            xcEmbedAttr('data-xc-embed-injected', String(ver || ''));
            console.log(TAG, '[内置小抄] 已注入官方小抄 ' + (ver || '') + '（页面主环境）');
        } else {
            xcEmbedState.error = '注入失败';
            xcEmbedAttr('data-xc-embed', 'inject-failed');
        }
        return ok;
    }
    function xcEmbedCheckUpdate(currentVer) {
        return xcEmbedConfig().then(function (cfg) {
            xcEmbedState.latest = cfg.version;
            xcEmbedAttr('data-xc-embed-latest', cfg.version);
            if (!cfg.version || cfg.version === currentVer) return false;
            return xcEmbedDownload().then(function (res) {
                return xcEmbedCachePut(res.source, res.version).then(function (ok) {
                    if (ok) {
                        xcEmbedSetVer(res.version);
                        console.log(TAG, '[内置小抄] 发现官方新版本 ' + res.version +
                            '，已下载缓存，刷新页面后生效');
                        try { showToast('小抄新版本 v' + res.version + ' 已下载，重进游戏后生效', 6000); } catch (e2) {}
                        return true;
                    }
                    return false;
                });
            });
        }).catch(function (e) {
            xcEmbedState.error = String((e && e.message) || e);
            xcEmbedAttr('data-xc-embed-error', xcEmbedState.error);
            return false;
        });
    }
    // 启用/停用（供自检卡片 / 移动端首次运行弹窗调用）
    function xcEmbedEnable() {
        xcEmbedState.downloading = true;
        xcEmbedAttr('data-xc-embed', 'downloading');
        return xcEmbedDownload().then(function (res) {
            return xcEmbedCachePut(res.source, res.version).then(function (ok) {
                xcEmbedState.downloading = false;
                if (!ok) throw new Error('缓存写入失败（Cache API 不可用）');
                xcEmbedSetFlag(true);
                xcEmbedSetVer(res.version);
                xcEmbedState.latest = res.version;
                xcEmbedAttr('data-xc-embed', 'downloaded');
                console.log(TAG, '[内置小抄] 已下载 ' + res.version + '，重进游戏后启用');
                return res.version;
            });
        }).catch(function (e) {
            xcEmbedState.downloading = false;
            xcEmbedState.error = String((e && e.message) || e);
            xcEmbedAttr('data-xc-embed-error', xcEmbedState.error);
            throw e;
        });
    }
    function xcEmbedDisable() {
        xcEmbedSetFlag(false);
        xcEmbedSetVer('');
        try { if (window.caches) caches.delete(EMBED_CACHE_NAME); } catch (e) {}
        xcEmbedAttr('data-xc-embed', 'off');
        console.log(TAG, '[内置小抄] 已停用');
    }

    // ---- 移动端弹窗：无缓存时提示下载；下载/更新完成后提示重进游戏 ----
    function xcEmbedReenter() {
        try {
            var host = String(location.hostname || '').toLowerCase();
            if (host === 'web.sanguosha.com') {
                location.assign(XC_OFFICIAL_LOGIN_URL);
                return;
            }
        } catch (e) {}
        try { location.reload(); } catch (e) {}
    }

    function xcEmbedBtn(text, primary) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = text;
        b.style.cssText = 'flex:1 1 0;min-height:40px;padding:0 10px;border-radius:9px;' +
            'border:1px solid ' + (primary ? 'rgba(242,222,156,.72)' : 'rgba(242,222,156,.3)') + ';' +
            'background:' + (primary ? 'linear-gradient(180deg,#d4b56a,#b8923f)' : 'rgba(52,47,40,.9)') + ';' +
            'color:' + (primary ? '#2a2010' : '#f2de9c') + ';font-size:14px;font-weight:600;cursor:pointer;';
        return b;
    }

    function xcEmbedDialog(titleText, msgText, statusText) {
        var host = document.body || document.documentElement;
        if (!host) return null;
        var old = document.getElementById(EMBED_MODAL_ID);
        if (old && old.parentNode) old.parentNode.removeChild(old);
        var box = document.createElement('div');
        box.id = EMBED_MODAL_ID;
        box.setAttribute('data-xc-ext', 'embed-modal');
        box.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483647;' +
            'display:flex;align-items:center;justify-content:center;padding:18px;box-sizing:border-box;' +
            'background:rgba(0,0,0,.72);font:14px/1.6 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;';
        var card = document.createElement('div');
        card.style.cssText = 'width:min(92vw,420px);box-sizing:border-box;background:#1d1a16;' +
            'border:1px solid rgba(242,222,156,.45);border-radius:12px;padding:18px 18px 16px;color:#f2de9c;' +
            'box-shadow:0 12px 40px rgba(0,0,0,.55);';
        var title = document.createElement('div');
        title.style.cssText = 'font-size:17px;font-weight:700;line-height:1.4;margin:0 0 8px';
        var msg = document.createElement('div');
        msg.style.cssText = 'font-size:13px;line-height:1.7;color:#e7d9b0;margin:0 0 4px;word-break:break-word';
        var status = document.createElement('div');
        status.style.cssText = 'margin-top:10px;font-size:12px;line-height:1.6;color:#a99572;word-break:break-all';
        var btns = document.createElement('div');
        btns.style.cssText = 'display:flex;gap:10px;margin-top:16px';
        card.appendChild(title);
        card.appendChild(msg);
        card.appendChild(status);
        card.appendChild(btns);
        box.appendChild(card);
        host.appendChild(box);
        function close() { try { if (box.parentNode) box.parentNode.removeChild(box); } catch (e) {} }
        return {
            box: box, title: title, msg: msg, status: status, btns: btns, close: close,
            set: function (t, m, s) {
                title.textContent = t || '';
                msg.textContent = m || '';
                status.textContent = s || '';
            }
        };
    }

    function xcEmbedShowReenterDialog(ver) {
        if (!xcIsTouchDevice()) return;
        var d = xcEmbedDialog(
            '内置小抄已更新',
            '已下载小抄 v' + (ver || '') + '，重进游戏后生效。',
            '官服会跳转到登录入口；其他渠道会刷新当前页面。');
        if (!d) return;
        var go = xcEmbedBtn('重进游戏', true);
        go.addEventListener('click', function (ev) {
            ev.preventDefault(); ev.stopPropagation();
            xcEmbedReenter();
        });
        var later = xcEmbedBtn('稍后', false);
        later.addEventListener('click', function (ev) {
            ev.preventDefault(); ev.stopPropagation();
            d.close();
        });
        d.btns.appendChild(go);
        d.btns.appendChild(later);
    }

    function xcEmbedShowDownloadPrompt() {
        if (!xcIsTouchDevice()) return;
        if (document.getElementById(EMBED_MODAL_ID)) return;
        try {
            if (window.Uc1cryZVg || window.VIiR0YfvE4s || document.getElementById('GMHCcZ6JV')) return;
        } catch (e) {}
        var d = xcEmbedDialog(
            '未检测到小抄',
            '这台设备上还没有小抄。点击「下载小抄」从官方获取最新版（等同安装原版小抄）。',
            '只从 xiaochao.org 官方配置接口下载，并校验脚本头、版本与完整性。');
        if (!d) { setTimeout(xcEmbedShowDownloadPrompt, 400); return; }
        function showDownloadButtons() {
            d.btns.innerHTML = '';
            var dl = xcEmbedBtn('下载小抄', true);
            dl.addEventListener('click', function (ev) {
                ev.preventDefault(); ev.stopPropagation();
                if (dl.disabled) return;
                dl.disabled = true;
                dl.textContent = '下载中…';
                d.status.textContent = '正在从 xiaochao.org 下载并校验最新版…';
                xcEmbedEnable().then(function (ver) {
                    d.set('小抄已下载',
                        '已下载小抄 v' + ver + '，请重进游戏后生效。',
                        '官服会跳转到登录入口；其他渠道会刷新当前页面。');
                    d.btns.innerHTML = '';
                    var go = xcEmbedBtn('重进游戏', true);
                    go.addEventListener('click', function (ev2) {
                        ev2.preventDefault(); ev2.stopPropagation();
                        xcEmbedReenter();
                    });
                    var later = xcEmbedBtn('稍后', false);
                    later.addEventListener('click', function (ev2) {
                        ev2.preventDefault(); ev2.stopPropagation();
                        d.close();
                    });
                    d.btns.appendChild(go);
                    d.btns.appendChild(later);
                }).catch(function (e) {
                    var msg = String((e && e.message) || e || '未知错误');
                    d.status.textContent = '下载失败：' + msg + '（请检查网络后重试）';
                    dl.disabled = false;
                    dl.textContent = '重试下载';
                });
            });
            var later = xcEmbedBtn('稍后', false);
            later.addEventListener('click', function (ev) {
                ev.preventDefault(); ev.stopPropagation();
                d.close();
            });
            d.btns.appendChild(dl);
            d.btns.appendChild(later);
        }
        showDownloadButtons();
    }

    // 页面启动时的流程：
    //   - 有缓存：尽早注入（document-start），后台按设置检查官方新版本；
    //   - 移动端没有缓存：等页面里的官方小抄先声明全局，没有就弹窗提示下载；
    //   - PC 没有缓存：保持 2.5 的静默首次下载（仅手动启用内置小抄时才会走到）。
    function xcEmbedBootstrap() {
        xcEmbedState.enabled = xcEmbedFlag();
        xcEmbedState.auto = xcEmbedAutoFlag();
        if (!xcEmbedState.enabled) { xcEmbedAttr('data-xc-embed', 'off'); return; }
        xcEmbedAttr('data-xc-embed', 'on');
        xcEmbedCacheGet().then(function (src) {
            if (src && xcEmbedValid(src)) {
                var ver = xcEmbedGetVer();
                xcEmbedState.cached = ver;
                // 稍等一拍，让已安装的小抄先声明全局，避免双份
                setTimeout(function () {
                    xcEmbedInject(src, ver);
                    if (xcEmbedAutoFlag()) xcEmbedCheckUpdate(ver);
                }, 80);
                return;
            }
            if (xcIsTouchDevice()) {
                var waited = 0;
                (function waitInstalled() {
                    try {
                        if (/\/login\//i.test(String(location.pathname || ''))) return;
                        if (window.Uc1cryZVg || window.VIiR0YfvE4s || document.getElementById('GMHCcZ6JV')) {
                            xcEmbedAttr('data-xc-embed', 'skip-installed');
                            return;
                        }
                    } catch (e) {}
                    // 原版小抄在 iPad 上 HUD 可能几秒才出来，先等一会儿，避免误弹下载窗
                    if (waited >= 2100) { xcEmbedShowDownloadPrompt(); return; }
                    waited += 700;
                    setTimeout(waitInstalled, 700);
                })();
                return;
            }
            xcEmbedDownload().then(function (res) {
                return xcEmbedCachePut(res.source, res.version).then(function (ok) {
                    if (ok) {
                        xcEmbedSetVer(res.version);
                        xcEmbedState.latest = res.version;
                        xcEmbedAttr('data-xc-embed', 'downloaded');
                        console.log(TAG, '[内置小抄] 首次下载完成（' + res.version + '），刷新页面后启用');
                    } else {
                        xcEmbedState.error = '缓存写入失败';
                        xcEmbedAttr('data-xc-embed-error', xcEmbedState.error);
                    }
                });
            }).catch(function (e) {
                xcEmbedState.error = String((e && e.message) || e);
                xcEmbedAttr('data-xc-embed-error', xcEmbedState.error);
            });
        });
    }

    // ============ 9.【功能 1】给“跳转被屏蔽”提示条加上关闭叉 ============
    // 小抄脚本发现 window.open 被拦掉后，会在页面底部插入一条提示条：
    //   <div style="position:fixed;left:20px;right:20px;bottom:20px;...;z-index:9999;">
    //     <p>跳转的网站被您屏蔽了，请手动访问：<a target="_blank" href="...">...</a></p>
    //   </div>
    // 这条提示条没有任何关闭方式，这里给它补一个“×”，同一条链接只保留一条。
    let bannerObserver = null;

    function isBlockBanner(el) {
        try {
            if (!el || el.nodeType !== 1 || el.tagName !== 'DIV') return false;
            const style = el.getAttribute('style') || '';
            if (!/position\s*:\s*fixed/i.test(style) || !/z-index\s*:\s*9999/i.test(style)) return false;
            const text = el.textContent || '';
            return text.indexOf('跳转的网站被您屏蔽了') !== -1 || text.indexOf('请手动访问') !== -1;
        } catch (e) {
            return false;
        }
    }

    function listBlockBanners() {
        const out = [];
        try {
            const root = document.body || document.documentElement;
            if (!root || !root.querySelectorAll) return out;
            const divs = root.querySelectorAll('div');
            for (let i = 0; i < divs.length; i++) {
                if (isBlockBanner(divs[i])) out.push(divs[i]);
            }
        } catch (e) {}
        return out;
    }

    function removeElement(el) {
        try {
            if (!el) return;
            if (typeof el.remove === 'function') el.remove();
            else if (el.parentNode) el.parentNode.removeChild(el);
        } catch (e) {}
    }

    function decorateBanner(banner) {
        if (!banner || banner.__blockXiaochaoDecorated) return;
        if (banner.isConnected === false) return; // 已经被判重删掉了
        banner.__blockXiaochaoDecorated = true;

        // 同一条链接只保留最新的一条提示，避免连点之后堆一屏
        try {
            const link = banner.querySelector('a');
            const href = link && link.getAttribute('href');
            if (href) {
                listBlockBanners().forEach(function (other) {
                    if (other === banner) return;
                    const otherLink = other.querySelector('a');
                    if (otherLink && otherLink.getAttribute('href') === href) removeElement(other);
                });
            }
        } catch (e) {}

        // 提示条本体：给右侧的关闭按钮留出位置
        try {
            banner.style.paddingRight = '40px';
            banner.style.boxSizing = 'border-box';
        } catch (e) {}

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'blockXiaochaoClose';
        closeBtn.textContent = '×';
        closeBtn.title = '关闭';
        closeBtn.setAttribute('aria-label', '关闭提示');
        closeBtn.style.cssText = [
            'position:absolute',
            'top:50%',
            'right:8px',
            'transform:translateY(-50%)',
            'width:24px',
            'height:24px',
            'line-height:22px',
            'padding:0',
            'border:1px solid #ccc',
            'border-radius:50%',
            'background:#f5f5f5',
            'color:#666',
            'font-size:16px',
            'font-family:inherit',
            'cursor:pointer',
            'box-sizing:border-box'
        ].join(';') + ';';
        closeBtn.addEventListener('mouseenter', function () {
            closeBtn.style.background = '#e8e8e8';
            closeBtn.style.color = '#333';
        });
        closeBtn.addEventListener('mouseleave', function () {
            closeBtn.style.background = '#f5f5f5';
            closeBtn.style.color = '#666';
        });
        closeBtn.addEventListener('mousedown', function (e) {
            e.stopPropagation();
        });
        closeBtn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            removeElement(banner);
        });

        try {
            banner.appendChild(closeBtn);
        } catch (e) {}
        console.debug(TAG, '已为屏蔽提示条补上关闭按钮');
    }

    function scanBlockBanners() {
        listBlockBanners().forEach(decorateBanner);
    }

    function installBannerObserver() {
        if (bannerObserver) return;
        try {
            bannerObserver = new MutationObserver(function (records) {
                let needScan = false;
                for (let i = 0; i < records.length; i++) {
                    const added = records[i].addedNodes || [];
                    for (let j = 0; j < added.length; j++) {
                        const node = added[j];
                        if (!node || node.nodeType !== 1) continue;
                        if (isBlockBanner(node)) decorateBanner(node);
                        else if (node.tagName === 'P' && /请手动访问/.test(node.textContent || '')) needScan = true;
                    }
                }
                if (needScan) scanBlockBanners();
            });
            bannerObserver.observe(document, { childList: true, subtree: true });
        } catch (e) {
            console.debug(TAG, '提示条监听安装失败:', e);
            bannerObserver = null;
        }
    }

    // 自己弹一条同款（但可关闭）的提示条
    function showBlockBanner(url) {
        try {
            const body = document.body || document.documentElement;
            if (!body || typeof body.insertAdjacentHTML !== 'function') return;
            const style = 'position:fixed;left:20px;right:20px;bottom:20px;padding:12px;background:#fff;border:1px solid #ccc;z-index:9999;';
            const html = '<div style="' + style + '"><p>跳转的网站被您屏蔽了，请手动访问：<a href="' + url + '" target="_blank">' + url + '</a></p></div>';
            body.insertAdjacentHTML('beforeend', html);
            scanBlockBanners();
        } catch (e) {}
    }

    // ============ 10.【功能 2】在小抄 HUD 里重新实现“检测更新” ============
    // 小抄自己的检测更新走 https://xiaochao.org/api/config，被本脚本拦掉后会变成“联系作者”。
    // 这里由屏蔽脚本接管同一个按钮，用原生请求重新实现检测：只有手动点按钮时才会发一次请求。
    //
    // 想换成自建镜像：把 mirrorUrl 填上即可（返回 { version: "1.5.76", url: "下载地址" }
    // 或与官方一致的 { scriptVersion, scriptUrl }）。不想联网检测就把 enabled 改成 false。
    const UPDATE_CFG = {
        enabled: true,
        apiUrl: 'https://xiaochao.org/api/config',
        mirrorUrl: '',
        downloadUrl: 'https://xiaochao.org/download/%E5%B0%8F%E6%8A%84.user.js',
        openDownloadDirectly: true,
        timeout: 6000,
        fallbackLocalVersion: '1.5.98'
    };

    // 小抄每个大版本都可能换掉 HUD 的 DOM id，这里把已知的几代都列上，另外再按 tooltip 兜底。
    const UPDATE_BTN_IDS = ['SjAbdx', 'AHZ1Vswa', 'MLTcdtlEr'];   // 1.6.66 / 1.5.98 / 1.5.96
    const UPDATE_BTN_FLAG = 'data-xc-block-update';
    const VERSION_SPAN_IDS = ['CzaP1ynlMHx', 'oKm1gvn3FZ', 'X1C4cjQK4OAp']; // 1.6.66 / 1.5.98 / 1.5.96
    const UPDATE_LONG_PRESS_MS = 1200;
    const UPDATE_BTN_SELECTOR = '#' + UPDATE_BTN_IDS.join(',#') + ',[' + UPDATE_BTN_FLAG + '],button[data-tooltip^="检测更新"]';
    // 按钮状态用本扩展自己的类名（小抄的类名每版都会变，跟着改只会一直失效）
    const CLS_LOADING = 'xcExtUpdBusy';
    const CLS_HAS_UPDATE = 'xcExtUpdNew';
    const CLS_IS_LATEST = 'xcExtUpdLatest';
    const CLS_CONTACT = 'xcExtUpdContact';
    const UPDATE_STYLE_ID = 'xcExtUpdateStyle';

    function cmpVersion(a, b) {
        const pa = String(a || '0').split('.').map(function (s) { return parseInt(s, 10) || 0; });
        const pb = String(b || '0').split('.').map(function (s) { return parseInt(s, 10) || 0; });
        const len = Math.max(pa.length, pb.length);
        for (let i = 0; i < len; i++) {
            const x = pa[i] || 0;
            const y = pb[i] || 0;
            if (x > y) return 1;
            if (x < y) return -1;
        }
        return 0;
    }

    function getLocalVersion() {
        const isVersion = function (s) { return /^\d+(\.\d+)*$/.test(String(s || '').trim()); };
        // 1) HUD 里的版本号（小抄自己会把 SCRIPT_VERSION 写进去）
        for (let i = 0; i < VERSION_SPAN_IDS.length; i++) {
            try {
                const span = document.getElementById(VERSION_SPAN_IDS[i]);
                const text = span && String(span.textContent || '').trim();
                if (isVersion(text)) return text;
            } catch (e) {}
        }
        // 2) 退化成读 HUD 文本里的「小抄 vX.Y.Z」
        try {
            const root = document.getElementById('ZuNpQvD38XO') || document.body;
            const text = root && String(root.textContent || '');
            const m = text && text.match(/小抄\s*v\s*(\d+(?:\.\d+)*)/);
            if (m && isVersion(m[1])) return m[1];
        } catch (e) {}
        // 2.5 起内置小抄缓存了自己的版本号：HUD 还没注入时也能判断
        try {
            const cached = xcEmbedGetVer();
            if (isVersion(cached)) return cached;
        } catch (e) {}
        // 3) 最后才考虑 GM_info，而且要确认它描述的是小抄而不是本扩展
        try {
            const info = window.GM_info;
            const name = String((info && info.script && info.script.name) || '');
            const v = info && info.script && info.script.version;
            if (v && name.indexOf('小抄') >= 0 && name.indexOf('拓展') < 0) return String(v).trim();
        } catch (e) {}
        return UPDATE_CFG.fallbackLocalVersion;
    }

    // 自绘提示条（小抄的提示接口每个版本都会换名，就不再借用它的了）
    function showToast(text, ms) {
        try {
            const body = document.body || document.documentElement;
            if (!body) return;
            const el = document.createElement('div');
            el.textContent = String(text).replace(/<br\s*\/?>/gi, ' ');
            el.style.cssText = [
                'position:fixed',
                'left:50%',
                'top:14%',
                'transform:translateX(-50%)',
                'max-width:80vw',
                'padding:10px 16px',
                'background:rgba(20,20,20,.9)',
                'color:#fff',
                'border-radius:8px',
                'font-size:13px',
                'line-height:1.5',
                'z-index:10000',
                'box-shadow:0 4px 12px rgba(0,0,0,.35)'
            ].join(';') + ';';
            body.appendChild(el);
            setTimeout(function () { removeElement(el); }, ms || 4000);
        } catch (e) {}
    }

    // ---- 网络（只用原生对象，绕开本脚本自己的拦截器） ----
    let proxyWorker = null; // worker 代理；false 表示不可用
    let proxySeq = 0;
    const proxyPending = new Map();

    function getProxyWorker() {
        if (proxyWorker) return proxyWorker;
        if (proxyWorker === false) return null;
        if (typeof NATIVE.Worker !== 'function' || typeof URL === 'undefined' || typeof Blob === 'undefined' || !URL.createObjectURL) {
            proxyWorker = false;
            return null;
        }
        try {
            const src = 'self.onmessage=function(e){"use strict";var d=e.data||{};' +
                'var done=function(o){o.id=d.id;self.postMessage(o);};' +
                'fetch(d.url,{method:"GET",mode:"cors",credentials:"omit",cache:"no-store",referrerPolicy:"no-referrer"})' +
                '.then(function(r){return r.text().then(function(t){done({ok:r.ok,status:r.status,text:t});});})' +
                '.catch(function(err){done({networkError:String((err&&err.message)||err)});});};';
            const blobUrl = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
            const worker = new NATIVE.Worker(blobUrl);
            try { URL.revokeObjectURL(blobUrl); } catch (e) {}
            worker.onmessage = function (ev) {
                const data = ev && ev.data;
                if (!data || !proxyPending.has(data.id)) return;
                const task = proxyPending.get(data.id);
                proxyPending.delete(data.id);
                if (data.networkError) task.reject(new Error(data.networkError));
                else task.resolve(String(data.text == null ? '' : data.text));
            };
            worker.onerror = function () {
                proxyPending.forEach(function (task) { task.reject(new Error('网络代理异常')); });
                proxyPending.clear();
                proxyWorker = false;
            };
            proxyWorker = worker;
            return worker;
        } catch (e) {
            proxyWorker = false;
            return null;
        }
    }

    function getViaProxy(url, timeoutMs) {
        return new Promise(function (resolve, reject) {
            const worker = getProxyWorker();
            if (!worker) { reject(new Error('网络代理不可用')); return; }
            const id = ++proxySeq;
            const timer = setTimeout(function () {
                if (proxyPending.has(id)) proxyPending.delete(id);
                reject(new Error('timeout'));
            }, timeoutMs);
            proxyPending.set(id, {
                resolve: function (v) { clearTimeout(timer); resolve(v); },
                reject: function (e) { clearTimeout(timer); reject(e); }
            });
            try {
                worker.postMessage({ id: id, url: url });
            } catch (e) {
                proxyPending.delete(id);
                clearTimeout(timer);
                reject(e);
            }
        });
    }

    function httpGet(url, timeoutMs) {
        const withTimeout = function (p) {
            return new Promise(function (resolve, reject) {
                let done = false;
                const timer = setTimeout(function () {
                    if (done) return;
                    done = true;
                    reject(new Error('timeout'));
                }, timeoutMs);
                p.then(function (v) {
                    if (done) return;
                    done = true;
                    clearTimeout(timer);
                    resolve(v);
                }, function (e) {
                    if (done) return;
                    done = true;
                    clearTimeout(timer);
                    reject(e);
                });
            });
        };
        const tryFetch = function () {
            if (typeof NATIVE.fetch !== 'function') return Promise.reject(new Error('fetch 不可用'));
            return NATIVE.fetch(url, {
                method: 'GET',
                mode: 'cors',
                credentials: 'omit',
                cache: 'no-store',
                referrerPolicy: 'no-referrer'
            }).then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.text();
            });
        };
        const tryXhr = function () {
            return new Promise(function (resolve, reject) {
                try {
                    const xhr = new NATIVE.XHR();
                    xhr.open('GET', url, true);
                    xhr.timeout = timeoutMs;
                    xhr.onload = function () {
                        if (xhr.status >= 200 && xhr.status < 300) resolve(String(xhr.responseText || ''));
                        else reject(new Error('HTTP ' + xhr.status));
                    };
                    xhr.onerror = function () { reject(new Error('网络错误')); };
                    xhr.ontimeout = function () { reject(new Error('timeout')); };
                    xhr.send();
                } catch (e) {
                    reject(e);
                }
            });
        };
        return withTimeout(tryFetch())
            .catch(function () { return withTimeout(getViaProxy(url, timeoutMs)); })
            .catch(function () { return withTimeout(tryXhr()); });
    }

    function pickDownloadUrl(raw) {
        const s = String(raw || '').trim();
        if (/^https?:\/\//i.test(s)) return s;
        return UPDATE_CFG.downloadUrl;
    }

    function fetchUpdateInfo() {
        const sources = [];
        if (UPDATE_CFG.mirrorUrl) sources.push(UPDATE_CFG.mirrorUrl);
        if (UPDATE_CFG.apiUrl) sources.push(UPDATE_CFG.apiUrl);
        if (!sources.length) return Promise.reject(new Error('未配置更新检测地址'));

        let lastError = null;
        const tryNext = function (index) {
            if (index >= sources.length) {
                return Promise.reject(lastError || new Error('没有可用的更新检测地址'));
            }
            const url = sources[index];
            return httpGet(url, UPDATE_CFG.timeout).then(function (text) {
                let data = null;
                try { data = JSON.parse(text); } catch (e) { throw new Error('返回内容不是 JSON'); }
                const version = String((data && (data.scriptVersion || data.version || data.latestVersion)) || '').trim();
                if (!/^\d+(\.\d+)*$/.test(version)) throw new Error('返回数据里没有版本号');
                return {
                    version: version,
                    url: pickDownloadUrl(data && (data.scriptUrl || data.url))
                };
            }).catch(function (e) {
                lastError = e;
                return tryNext(index + 1);
            });
        };
        return tryNext(0);
    }

    // ---- 按钮状态 ----
    function setBtnLabel(btn, text) {
        try {
            btn.setAttribute('aria-label', text);
            btn.dataset.tooltip = text;
        } catch (e) {}
    }

    // 更新按钮的状态样式由本扩展自带（小抄的类名每版都会变，不再依赖）
    function ensureUpdateStyle() {
        if (!document || !document.head) return;
        if (document.getElementById(UPDATE_STYLE_ID)) return;
        try {
            const style = document.createElement('style');
            style.id = UPDATE_STYLE_ID;
            style.textContent = [
                '.' + CLS_LOADING + '{opacity:.7;cursor:progress}',
                '.' + CLS_IS_LATEST + '{color:#9fdc8f;border-color:rgba(159,220,143,.6)}',
                '.' + CLS_HAS_UPDATE + '{color:#ffd666;border-color:rgba(245,197,66,.7);box-shadow:0 0 6px rgba(245,197,66,.25)}',
                '.' + CLS_CONTACT + '{color:#e5a0a0;border-color:rgba(229,102,102,.6)}',
                '#' + UPDATE_BTN_IDS[0] + ',[' + UPDATE_BTN_FLAG + ']{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}'
            ].join('\n');
            (document.head || document.documentElement).appendChild(style);
        } catch (e) {}
    }

    function xcUpdateBtnTooltip(btn) {
        try {
            btn.dataset.tooltip = '检测更新\n长按可开启/关闭自动检查更新\n当前（拓展）：' +
                (xcEmbedAutoFlag() ? '已开启' : '已关闭');
        } catch (e) {}
    }

    function xcUpdateBtnFrom(target) {
        try {
            if (!target || typeof target.closest !== 'function') return null;
            // 优先按 id 找；小抄换 id 时退化成按 tooltip 找（找到后会被打上标记，后续仍能命中）
            return target.closest(UPDATE_BTN_SELECTOR);
        } catch (e) { return null; }
    }

    function resetUpdateBtn(btn) {
        try {
            delete btn.dataset.updateReady;
            delete btn.dataset.contactAuthor;
            delete btn.dataset.xcBlockUpdateUrl;
            xcUpdateBtnTooltip(btn);
            btn.disabled = false;
            btn.classList.remove(CLS_HAS_UPDATE, CLS_IS_LATEST, CLS_CONTACT);
        } catch (e) {}
    }

    function openUpdatePage(url) {
        if (!url) return;
        if (UPDATE_CFG.openDownloadDirectly && typeof NATIVE.open === 'function') {
            try {
                const win = NATIVE.open.call(window, url, '_blank');
                if (win && !win.closed) return;
            } catch (e) {}
        }
        // 不用 showBlockBanner：那套文案是「跳转被屏蔽」，这里只是弹窗被浏览器拦了
        showToast('请手动打开更新地址：' + url, 12000);
    }

    function runUpdateCheck(btn) {
        if (!UPDATE_CFG.enabled) {
            showToast('屏蔽脚本已关闭更新检测', 4000);
            return;
        }
        try {
            ensureUpdateStyle();
            btn.dataset.xcBlockUpdateBusy = 'true';
            btn.disabled = true;
            btn.classList.remove(CLS_HAS_UPDATE, CLS_IS_LATEST, CLS_CONTACT);
            btn.classList.add(CLS_LOADING);
            setBtnLabel(btn, '检测中…');
            showToast('正在检测小抄更新…', 6000);
            const local = getLocalVersion();
            fetchUpdateInfo().then(function (info) {
                if (cmpVersion(info.version, local) <= 0) {
                    setBtnLabel(btn, '已是最新版 v' + info.version);
                    btn.classList.add(CLS_IS_LATEST);
                    showToast('当前已是最新版 v' + info.version, 4000);
                    setTimeout(function () {
                        if (btn.isConnected && btn.dataset.updateReady !== 'true') resetUpdateBtn(btn);
                    }, 4000);
                    return;
                }
                btn.dataset.updateReady = 'true';
                btn.dataset.xcBlockUpdateUrl = info.url || UPDATE_CFG.downloadUrl;
                btn.classList.add(CLS_HAS_UPDATE);
                if (xcIsTouchDevice()) {
                    // 移动端：更新拓展缓存里的那一份小抄，刷新/重进后生效
                    setBtnLabel(btn, '更新内置小抄 v' + info.version);
                    showToast('发现小抄新版本 v' + info.version + '（当前 v' + local + '），正在更新内置小抄…', 6000);
                    return xcEmbedEnable().then(function (ver) {
                        showToast('内置小抄已更新到 v' + ver, 4000);
                        xcEmbedShowReenterDialog(ver);
                    });
                }
                // PC：检查到新版本后直接打开正常的油猴更新页
                setBtnLabel(btn, '前往更新 v' + info.version);
                showToast('发现小抄新版本 v' + info.version + '（当前 v' + local + '），正在打开油猴更新…', 6000);
                openUpdatePage(info.url || UPDATE_CFG.downloadUrl);
            }).catch(function (err) {
                const msg = String((err && err.message) || err || '未知错误');
                console.warn(TAG, '更新检测失败:', err);
                setBtnLabel(btn, '检测更新');
                try { btn.dataset.tooltip = '检测更新（失败：' + msg + '）'; } catch (e) {}
                showToast('更新检测失败：' + msg, 5000);
            }).then(function () {
                try {
                    btn.classList.remove(CLS_LOADING);
                    btn.disabled = false;
                    delete btn.dataset.xcBlockUpdateBusy;
                } catch (e) {}
            });
        } catch (e) {
            console.debug(TAG, '更新检测流程异常:', e);
            resetUpdateBtn(btn);
        }
    }

    // 自动检查更新：
    //   - 移动端：后台更新内置小抄缓存（有缓存才检查）；
    //   - PC：只提示发现新版本，点击更新按钮再走油猴更新，不自动跳转。
    function xcUpdateBackgroundCheck(force) {
        if (!force && !xcEmbedAutoFlag()) return;
        if (xcIsTouchDevice()) {
            if (xcEmbedFlag() && xcEmbedGetVer()) {
                try { xcEmbedCheckUpdate(xcEmbedGetVer()); } catch (e) {}
            }
            return;
        }
        // PC 默认什么都不做；只有用户明确长按开启过自动检查，才在后台检查并提示。
        var explicit = false;
        try { explicit = localStorage.getItem(EMBED_AUTO_KEY) === '1'; } catch (e) {}
        if (!force && !explicit) return;
        fetchUpdateInfo().then(function (info) {
            var local = getLocalVersion();
            if (cmpVersion(info.version, local) > 0) {
                showToast('小抄有新版本 v' + info.version + '（当前 v' + local + '），点更新按钮前往更新', 8000);
            }
        }).catch(function () {});
    }

    function onUpdateBtnClick(btn) {
        if (btn.dataset.xcBlockUpdateBusy === 'true') return;
        if (btn.__xcLongPressAt && Date.now() - btn.__xcLongPressAt < 900) return;
        if (btn.dataset.updateReady === 'true') {
            if (xcIsTouchDevice()) {
                const ver = xcEmbedGetVer();
                if (ver) { xcEmbedShowReenterDialog(ver); return; }
            } else {
                const url = btn.dataset.xcBlockUpdateUrl || UPDATE_CFG.downloadUrl;
                showToast('正在打开小抄更新页面…', 3000);
                openUpdatePage(url);
                return;
            }
        }
        runUpdateCheck(btn);
    }

    // 长按更新按钮：开关「自动检查更新」（移动端用于后台更新缓存的小抄）。
    // 捕获阶段拦掉 pointerdown，避免原版小抄同时切它自己的开关，出现两个状态打架。
    const xcUpdateLongPress = { timer: 0, x: 0, y: 0 };
    function xcUpdateCancelLongPress() {
        if (xcUpdateLongPress.timer) {
            clearTimeout(xcUpdateLongPress.timer);
            xcUpdateLongPress.timer = 0;
        }
    }
    function xcUpdateEventPoint(e) {
        if (!e) return null;
        if (e.touches && e.touches.length) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
        if (e.changedTouches && e.changedTouches.length) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
        if (typeof e.clientX === 'number') return { x: e.clientX, y: e.clientY };
        return null;
    }
    function xcInstallUpdateLongPress() {
        if (document.__xcUpdateLongPressHooked) return;
        document.__xcUpdateLongPressHooked = true;
        function start(e) {
            const btn = xcUpdateBtnFrom(e.target);
            if (!btn || btn.disabled) return;
            if (typeof e.button === 'number' && e.button !== 0) return;
            const p = xcUpdateEventPoint(e);
            if (!p) return;
            try {
                e.stopPropagation();
                if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
            } catch (err) {}
            xcUpdateCancelLongPress();
            xcUpdateLongPress.x = p.x;
            xcUpdateLongPress.y = p.y;
            xcUpdateLongPress.timer = setTimeout(function () {
                xcUpdateLongPress.timer = 0;
                try { btn.__xcLongPressAt = Date.now(); } catch (e2) {}
                const on = !xcEmbedAutoFlag();
                xcEmbedSetAutoFlag(on);
                xcUpdateBtnTooltip(btn);
                showToast('自动检查更新：' + (on ? '已开启' : '已关闭'), 4000);
                console.log(TAG, '[内置小抄] 自动检查更新：' + (on ? '开' : '关'));
                if (on && xcEmbedFlag()) {
                    try { xcUpdateBackgroundCheck(true); } catch (e3) {}
                }
            }, UPDATE_LONG_PRESS_MS);
        }
        function move(e) {
            if (!xcUpdateLongPress.timer) return;
            const p = xcUpdateEventPoint(e);
            if (!p) return;
            if (Math.abs(p.x - xcUpdateLongPress.x) + Math.abs(p.y - xcUpdateLongPress.y) > 10) {
                xcUpdateCancelLongPress();
            }
        }
        function end() { xcUpdateCancelLongPress(); }
        const moveTypes = window.PointerEvent ? ['pointermove'] : ['touchmove', 'mousemove'];
        const endTypes = window.PointerEvent ? ['pointerup', 'pointercancel'] : ['touchend', 'touchcancel', 'mouseup'];
        const startTypes = window.PointerEvent ? ['pointerdown'] : ['touchstart', 'mousedown'];
        startTypes.forEach(function (t) { document.addEventListener(t, start, true); });
        moveTypes.forEach(function (t) { document.addEventListener(t, move, true); });
        endTypes.forEach(function (t) { document.addEventListener(t, end, true); });
    }

    function installHudUpdateHook() {
        if (document.__blockXiaochaoUpdateHooked) return;
        document.__blockXiaochaoUpdateHooked = true;
        ensureUpdateStyle();
        xcInstallUpdateLongPress();
        // 捕获阶段抢在小抄自己的点击处理之前拦下按钮点击
        document.addEventListener('click', function (e) {
            const btn = xcUpdateBtnFrom(e.target);
            if (!btn) return;
            try { btn.setAttribute(UPDATE_BTN_FLAG, '1'); } catch (e3) {}
            e.preventDefault();
            e.stopPropagation();
            if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
            onUpdateBtnClick(btn);
        }, true);
    }

    // ============ 11.【功能 3】秒杀连点：自动购买所选物品 ============
    // 小抄的「秒杀连点」面板在 HUD 工具页里（1.5.98 是 #vlweQaL > #leCxFzcsAQ0y，1.5.96 是 #seaAiJqW6kN > #sOthv2cJv3O；
    // 这些 id 每版都可能变，所以运行时按 id → 按钮文本 → 商品行祖先的顺序自动发现）。
    // 游戏推送秒杀数据时，小抄会重建列表里的复选框，每个复选框的 dataset 带：
    //   goods（价格 + 名称文本）、goods_id、base_id、act_id、start_time（开抢毫秒时间戳）、seckill_disabled。
    // 勾选其中一个就等于通知小抄自己的排程器在开抢时间自动购买（NewSecKillManager.ReqBuySeckillGoods），
    // 所以这里完全不用碰小抄内部代码，只做三件事：
    //   1) 按关键词自动勾选命中的商品；
    //   2) 列表被重建后把勾选恢复回来（原脚本“勾选自己掉了”的根因就是列表重建清空了选中状态）；
    //   3) 多个命中项时按开抢时间排队，抢完 / 过期后自动切下一个。
    // 注意：1.5.98 起勾选会弹确认框（见 skInstallConfirmHook），自动勾选需要静默通过它。
    // 小抄 1.5.98 把秒杀相关 id 全换了一遍，而且以后每版都可能再换，
    // 所以这里只把已知 id 当快捷路径，真正定位交给 skPanelEl()/skListEl() 在运行时发现。
    const SK_PANEL_IDS = ['vlweQaL', 'seaAiJqW6kN'];        // 1.5.98 / 1.5.96
    const SK_LIST_IDS = ['leCxFzcsAQ0y', 'sOthv2cJv3O'];   // 1.5.98 / 1.5.96
    const SK_BTN_TEXT = '秒杀连点';
    const SK_BOX_ID = 'xcExtSeckillAutoBuy';
    const SK_STATUS_ID = 'xcExtSeckillStatus';
    const SK_TAGS_ID = 'xcExtSeckillTags';
    const SK_CUSTOM_ID = 'xcExtSeckillCustom';
    const SK_STYLE_ID = 'xcExtSeckillStyle';
    const SK_STORAGE_KEY = 'xcExt:seckillAutoBuy';
    const SK_SCAN_MS = 10 * 60 * 1000;      // 每 10 分钟重扫一次秒杀列表
    const SK_TICK_MS = 3000;                // 兜底轮询：检测列表重建 / 补挂面板
    // 注：2.0.2 起不再按“开抢多久”硬性跳过。小抄渲染列表时已经过滤掉结束的商品，
    //     所以列表里还在的行就是还在卖的行；旧规则会把正在卖的便宜货（如祈福灯）整批漏掉。
    const SK_PAUSE_MS = 10 * 60 * 1000;     // 手动取消勾选后暂停自动勾选的时间
    const SK_TRY_MS = 1200;                 // 选中后给小抄约 3 次购买尝试的时间（小抄每 300ms 重试一次）
    const SK_RETRY_MS = 30 * 1000;          // 一轮没抢到，先跳下一个，30 秒后再回头试
    const SK_MAX_ROUNDS = 3;                // 每一项最多 3 轮（3×3 = 9 次尝试），再抢不到就放弃
    const SK_BUY_COOLDOWN_MS = 3000;        // 抢到一件后冷却 3 秒再抢下一件
    // 秒杀分场次（一般 0 / 8 / 12 / 19 点各一场）。场次戳用来做两件事：
    //   1) 每场开始时清掉上一场的“已抢到 / 已放弃 / 已跳过”，队列重新排队（否则挂机跨场次时第二场会被上一场的失败记录永久拉黑）；
    //   2) 重新勾选上一场的商品会让小抄向服务器请求最新库存，新一场的数据回来后面板会重绘，于是能发现并抢到新一场的商品。
    const SK_ROUND_HOURS = [0, 8, 12, 19];
    const SK_MAX_CUSTOM = 20;
    // 预置项：前 4 个为常用目标，后 4 个为常见秒杀物品（默认全部不勾选）
    // 数量/价格规则见 SK_RULES：秒杀列表里常驻款和限时款混在一起，只能靠“数量 + 价格”区分。
    const SK_ITEMS = [
        { id: 'huijuanmaobi', label: '绘卷毛笔', keyword: '毛笔', tip: '秒杀列表里出现「毛笔*3」（含绘卷毛笔）时自动帮抢' },
        { id: 'gongxun', label: '功勋', keyword: '功勋', tip: '秒杀列表里出现「功勋」时自动帮抢（不限数量）' },
        { id: 'pifubao', label: '皮肤包', keyword: '皮肤包', tip: '秒杀列表里出现「皮肤包」时自动帮抢（不限数量）' },
        { id: 'qizhenduobaoquan', label: '奇珍夺宝券', keyword: '奇珍夺宝券', tip: '秒杀列表里出现「奇珍夺宝券*10」时自动帮抢' },
        { id: 'duobaoquan', label: '夺宝券', keyword: '夺宝券', tip: '秒杀列表里出现「夺宝券*10」时自动帮抢；不含「奇珍夺宝券」，两者不会互相误判' },
        { id: 'zhaomuling', label: '招募令', keyword: '招募令', tip: '秒杀列表里出现「招募令」时自动帮抢（不限数量）' },
        { id: 'qifulideng', label: '祈福灯', keyword: '祈福灯', tip: '只抢 6666 元宝的「祈福灯*10」，其它价格/数量的都是常驻款不抢' },
        { id: 'longzhu', label: '龙珠', keyword: '龙珠', tip: '龙珠每期名字不同（忠义龙珠/锦鲤龙珠…），按「龙珠」二字匹配「xx龙珠*5」' }
    ];
    // 限时秒杀的识别规则（实测结论）：常驻款和限时款混在同一个列表里，
    // 只能靠“数量 + 价格”区分。这里按关键词自动套用，自定义关键词（比如「锦鲤龙珠」）也能命中规则。
    const SK_RULES = [
        { test: /龙珠/, count: [5] },              // 龙珠：数量恒为 5
        { test: /毛笔/, count: [3] },              // 毛笔 / 绘卷毛笔：数量恒为 3
        { test: /夺宝券/, count: [10] },           // 夺宝券 / 奇珍夺宝券：一组 10 个
        { test: /祈福灯/, count: [10], price: [6666] } // 祈福灯：6666 元宝的 10 个装
    ];
    // 功勋 / 皮肤包 / 招募令 不设规则：无论多少数额都算限时秒杀
    // 关键词互斥：避免子串互相误判（「夺宝券」是「奇珍夺宝券」的子串，勾了它不该再去抢奇珍夺宝券）
    const SK_KEYWORD_EXCLUDE = {
        '夺宝券': ['奇珍夺宝券']
    };
    const skState = {
        enabled: false,
        items: {},
        custom: [],
        done: {},          // { 行标识: 'YYYY-M-D' } 当天已抢到的商品
        skipped: {},
        queue: {},         // { 行标识: { rounds: 已试轮数, retryAt: 重试时间, failed: 试满放弃 } }
        nextBuyAt: 0,      // 抢到一件后的冷却截止时间
        targetKey: '',     // 当前已交给小抄排程的商品
        manualKey: '',     // 用户手动勾选的商品（优先，扩展不覆盖）
        pauseUntil: 0,     // 手动取消后暂停自动勾选到该时间
        tryDeadline: 0,    // 当前项的放弃时间（开抢后约 3 次尝试）
        tryRowKey: '',     // tryDeadline 对应的行
        roundStamp: 0,     // 当前场次的开始时间（0/8/12/19 点里最近的一个）
        refreshKey: '',    // 10 分钟强制刷新时临时占用的行
        signature: '',
        scans: 0,
        confirmBlocked: false   // 无法接管小抄的确认框时置位（自动勾选可能被弹窗拦住）
    };
    let skObserver = null;
    let skObserverTarget = null;
    let skScanTimer = 0;
    let skTryTimer = 0;
    let skAutoConfirm = false;   // 扩展自己派发勾选期间为 true，用于静默通过小抄的确认框

    function skToday() {
        const d = new Date();
        return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    }

    function skNorm(text) {
        return String(text == null ? '' : text).replace(/[\s\u00a0]+/g, '').toLowerCase();
    }

    function skTimeLabel(ms) {
        const d = new Date(Number(ms) || 0);
        const pad = function (n) { return (n < 10 ? '0' : '') + n; };
        return pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    // 当前场次的开始时间（今天 0/8/12/19 点里最近的一个）
    function skRoundStart(now) {
        const d = new Date(now || Date.now());
        const h = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
        let pick = SK_ROUND_HOURS[0];
        for (let i = 0; i < SK_ROUND_HOURS.length; i++) {
            if (h >= SK_ROUND_HOURS[i]) pick = SK_ROUND_HOURS[i];
        }
        const s = new Date(d.getFullYear(), d.getMonth(), d.getDate(), pick, 0, 0, 0);
        if (h < SK_ROUND_HOURS[0]) s.setDate(s.getDate() - 1);
        return s.getTime();
    }

    function skRoundLabel(stamp) {
        const d = new Date(Number(stamp) || Date.now());
        return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours() + '点场';
    }

    // 跨场次：把上一场的“已抢到 / 已放弃 / 已跳过 / 重试中”全部清掉，让新一场重新排队。
    // 这也是挂机跨场次的救命逻辑——不清的话第二场会一直被认为“已经抢过 / 已经试满”。
    function skRoundResetIfNeeded() {
        const stamp = skRoundStart(Date.now());
        if (skState.roundStamp === stamp) return false;
        const first = !skState.roundStamp;
        skState.roundStamp = stamp;
        const keep = {};
        Object.keys(skState.done || {}).forEach(function (k) {
            if (skState.done[k] === stamp) keep[k] = stamp;
        });
        skState.done = keep;
        skState.queue = {};
        skState.skipped = {};
        skState.nextBuyAt = 0;
        skState.targetKey = '';
        skState.manualKey = '';
        skClearTryDeadline();
        if (!first) {
            console.log(TAG, '[seckill] 进入新一场（' + skRoundLabel(stamp) + '），队列已重置，重新按面板排队');
            skStatus('进入新一场（' + skRoundLabel(stamp) + '），重新排队…');
        }
        return true;
    }

    // 面板内容指纹（只看商品本身，不看勾选状态，避免抢购过程中被频繁重置）
    function skPanelContentSig() {
        return skRows().map(function (r) { return r.key + ':' + String(r.goods || ''); }).join('|');
    }

    // 面板内容变了（服务器推了新一轮 / 新商品）→ 撤销“已放弃 / 已跳过 / 重试中”，重新排队。
    // 注意：本场已经抢到的（done）保留，避免同一场重复购买；跨场次由 skRoundResetIfNeeded 清掉。
    function skPanelChangedReset() {
        const sig = skPanelContentSig();
        if (!skState.panelSig) {
            skState.panelSig = sig;
            return false;
        }
        if (sig === skState.panelSig) return false;
        skState.panelSig = sig;
        skState.queue = {};
        skState.skipped = {};
        skState.nextBuyAt = 0;
        skClearTryDeadline();
        console.log(TAG, '[seckill] 秒杀面板内容有更新，已撤销放弃/跳过状态并重新排队');
        skStatus('秒杀面板有更新，重新排队…');
        return true;
    }

    // 每 10 分钟强制刷新一次：重新勾选一行会让小抄向服务器请求最新库存 / 数据，
    // 服务器回包后小抄会重绘面板（这也是拓展能主动触发的唯一刷新手段）。
    // 只挑命中规则的行来点，避免误买常驻款；正在抢 / 冷却中 / 没有命中项时跳过。
    function skForceRefresh() {
        if (!skState.enabled) return false;
        if (skState.targetKey || Date.now() < skState.nextBuyAt) return false;
        const kws = skKeywords();
        if (!kws.length) return false;
        let pick = null;
        skRows().forEach(function (row) {
            if (pick) return;
            const text = skNorm(row.goods);
            const parsed = skParseGoods(row.goods);
            for (let i = 0; i < kws.length; i++) {
                if (skKeywordHit(text, kws[i].keyword, parsed)) { pick = row; return; }
            }
        });
        if (!pick) return false;
        console.log(TAG, '[seckill] 10 分钟强制刷新：重新勾选一次以拉取最新秒杀数据 →', pick.goods);
        skInstallConfirmHook();
        skCheckRow(pick);
        const refreshKey = pick.key;
        skState.refreshKey = refreshKey;
        skStatus('正在向服务器请求最新秒杀数据…');
        // 只临时占用一下：小抄的购买循环一开始就会请求最新库存，拿到数据后立刻松开
        setTimeout(function () {
            if (skState.refreshKey !== refreshKey) return;
            skState.refreshKey = '';
            if (skState.targetKey === refreshKey) skState.targetKey = '';
            skClearTryDeadline();
            const cur = skKeyUnchecked(refreshKey);
            if (cur && cur.el.checked) skUncheckRow(cur);
            skScan('refresh-done');
        }, 1500);
        return true;
    }

    // ---- 设置读写 ----
    function skLoad() {
        let data = null;
        try {
            data = JSON.parse(localStorage.getItem(SK_STORAGE_KEY) || 'null');
        } catch (e) {
            data = null;
        }
        if (!data || typeof data !== 'object') return;
        skState.enabled = data.enabled === true;
        if (data.items && typeof data.items === 'object') {
            SK_ITEMS.forEach(function (it) {
                if (typeof data.items[it.id] === 'boolean') skState.items[it.id] = data.items[it.id];
            });
        }
        if (Array.isArray(data.custom)) {
            skState.custom = data.custom
                .filter(function (s) { return typeof s === 'string' && s.trim(); })
                .map(function (s) { return s.trim(); })
                .slice(0, SK_MAX_CUSTOM);
        }
        if (data.done && typeof data.done === 'object' && !Array.isArray(data.done)) {
            const today = skToday();
            const stamp = skRoundStart(Date.now());
            Object.keys(data.done).forEach(function (k) {
                const v = data.done[k];
                if (typeof v === 'number') {
                    // 新版：直接存场次戳，只认当前这一场
                    if (v === stamp) skState.done[k] = stamp;
                    return;
                }
                // 旧版存的是 'YYYY-M-D'，同一天的按“本场已抢到”处理
                if (v === today) skState.done[k] = stamp;
            });
        }
        skState.items = skState.items || {};
    }

    function skSave() {
        try {
            localStorage.setItem(SK_STORAGE_KEY, JSON.stringify({
                v: 2,
                enabled: skState.enabled,
                items: skState.items,
                custom: skState.custom,
                done: skState.done
            }));
        } catch (e) {
            console.debug(TAG, '[seckill] 设置保存失败:', e);
        }
    }

    // ---- 关键词 ----
    function skKeywords() {
        const out = [];
        SK_ITEMS.forEach(function (it) {
            if (skState.items[it.id]) out.push({ id: it.id, label: it.label, keyword: it.keyword });
        });
        skState.custom.forEach(function (kw, i) {
            out.push({ id: 'custom:' + i, label: kw, keyword: kw });
        });
        return out;
    }

    function skAddCustom(raw) {
        const kw = String(raw == null ? '' : raw).trim();
        if (!kw) return false;
        const exists = skState.custom.some(function (s) { return skNorm(s) === skNorm(kw); });
        if (exists) return false;
        if (skState.custom.length >= SK_MAX_CUSTOM) return false;
        skState.custom.push(kw);
        skSave();
        skRenderTags();
        skScan('keyword');
        return true;
    }

    // 某个关键词对应的排除词（统一按去掉空白、小写后的文本比较）
    function skExcludesFor(keyword) {
        const list = SK_KEYWORD_EXCLUDE[skNorm(keyword)];
        if (!Array.isArray(list)) return [];
        return list.map(skNorm);
    }

    // 秒杀行文本形如 "6666 元宝: 祈福灯*10"，解析出价格 / 货币 / 数量 / 名称
    function skParseGoods(raw) {
        let s = String(raw == null ? '' : raw);
        const out = { price: null, currency: '', count: null, name: '' };
        const cm = s.match(/\*\s*(\d+)\s*$/);
        if (cm) {
            out.count = Number(cm[1]);
            s = s.slice(0, cm.index);
        }
        const pm = s.match(/(\d[\d,]*)\s*(通用元宝|元宝|银两|铜币)/);
        if (pm) {
            out.price = Number(String(pm[1]).replace(/,/g, ''));
            out.currency = pm[2];
            s = s.slice(pm.index + pm[0].length);
        }
        out.name = s.replace(/^\s*[:：]\s*/, '').trim();
        return out;
    }

    // 关键词对应的限时秒杀规则（没规则的按“不限”处理）
    function skRuleFor(keyword) {
        const kw = skNorm(keyword);
        if (!kw) return null;
        for (let i = 0; i < SK_RULES.length; i++) {
            if (SK_RULES[i].test.test(kw)) return SK_RULES[i];
        }
        return null;
    }

    // 命中判定：包含关键词 + 不含排除词 + 满足该关键词的数量/价格规则（用来把常驻款排除掉）
    function skKeywordHit(text, keyword, parsed) {
        if (!keyword) return false;
        if (text.indexOf(skNorm(keyword)) < 0) return false;
        const ex = skExcludesFor(keyword);
        for (let i = 0; i < ex.length; i++) {
            if (ex[i] && text.indexOf(ex[i]) >= 0) return false;
        }
        const rule = skRuleFor(keyword);
        if (!rule) return true;
        if (rule.count && rule.count.indexOf(parsed.count) < 0) return false;
        if (rule.price && rule.price.indexOf(parsed.price) < 0) return false;
        return true;
    }

    function skRemoveCustom(index) {
        if (index < 0 || index >= skState.custom.length) return;
        skState.custom.splice(index, 1);
        skSave();
        skRenderTags();
        skScan('keyword');
    }

    // ---- 秒杀列表读取 ----
    function skByIds(ids) {
        for (let i = 0; i < ids.length; i++) {
            try {
                const el = document.getElementById(ids[i]);
                if (el) return el;
            } catch (e) {}
        }
        return null;
    }

    // 秒杀连点按钮：按文本找，取它的下一个兄弟节点当面板（不依赖 id）
    function skPanelByButton() {
        try {
            const buttons = document.querySelectorAll('button');
            for (let i = 0; i < buttons.length; i++) {
                const btn = buttons[i];
                if (String(btn.textContent || '').trim() === SK_BTN_TEXT && btn.nextElementSibling) {
                    return btn.nextElementSibling;
                }
            }
        } catch (e) {}
        return null;
    }

    // 商品行的最近带 id 祖先，就是小抄渲染出来的列表容器
    function skListEl() {
        try {
            const byId = skByIds(SK_LIST_IDS);
            if (byId) return byId;
            const nodes = document.querySelectorAll('input[type="checkbox"][data-seckill="true"]');
            for (let i = 0; i < nodes.length; i++) {
                const holder = nodes[i].closest('div[id]');
                if (holder) return holder;
            }
        } catch (e) {
            // ignore
        }
        return null;
    }

    function skPanelEl() {
        const byId = skByIds(SK_PANEL_IDS);
        if (byId) return byId;
        const byBtn = skPanelByButton();
        if (byBtn) return byBtn;
        const list = skListEl();
        return (list && list.parentElement) || null;
    }

    function skRowOf(el) {
        const ds = (el && el.dataset) || {};
        return {
            el: el,
            goods: String(ds.goods || ''),
            goodsId: String(ds.goods_id || ''),
            actId: String(ds.act_id || ''),
            baseId: String(ds.base_id || ''),
            startMs: Number(ds.start_time) || 0,
            disabled: ds.seckill_disabled === '1' || el.disabled === true,
            key: [ds.goods_id, ds.act_id, ds.base_id, ds.start_time].join('|')
        };
    }

    function skRows() {
        // 全文档查询（和小抄自己换 id 后的兜底写法一致），这样列表容器换名也不影响
        let nodes = null;
        try {
            nodes = document.querySelectorAll('input[type="checkbox"][data-seckill="true"]');
        } catch (e) {
            nodes = null;
        }
        if (!nodes || !nodes.length) {
            const list = skListEl();
            nodes = (list && list.querySelectorAll) ? list.querySelectorAll('input[type="checkbox"][data-seckill="true"]') : null;
        }
        if (!nodes) return [];
        const out = [];
        for (let i = 0; i < nodes.length; i++) out.push(skRowOf(nodes[i]));
        return out;
    }

    // 命中项：限时秒杀（关键词 + 数量/价格规则）+ 未禁用 + 今天没抢到 + 没被跳过 / 放弃
    function skHits() {
        const kws = skKeywords();
        if (!kws.length) return [];
        const stamp = skState.roundStamp;
        const now = Date.now();
        const hits = [];
        skRows().forEach(function (row) {
            if (row.disabled) return;
            if (skState.done[row.key] === stamp) return;
            if (skState.skipped[row.key]) return;
            if (skQueueBusy(row, now)) return;
            const text = skNorm(row.goods);
            const parsed = skParseGoods(row.goods);
            let matched = null;
            for (let i = 0; i < kws.length; i++) {
                const kw = kws[i];
                if (skKeywordHit(text, kw.keyword, parsed)) { matched = kw; break; }
            }
            if (!matched) return;
            hits.push({ row: row, kw: matched });
        });
        // 已开抢的优先，其余按开抢时间升序
        hits.sort(function (a, b) {
            const aliveA = a.row.startMs && a.row.startMs <= now ? 0 : 1;
            const aliveB = b.row.startMs && b.row.startMs <= now ? 0 : 1;
            if (aliveA !== aliveB) return aliveA - aliveB;
            return (a.row.startMs || 0) - (b.row.startMs || 0);
        });
        return hits;
    }

    // 把列表里每一项按“命中关键词 / 为什么不能抢”分类，用来把状态行写清楚
    function skClassify() {
        const stamp = skState.roundStamp;
        const kws = skKeywords();
        const rows = skRows();
        const stat = {
            total: rows.length, matched: 0, ready: 0,
            blockedDisabled: 0, blockedDone: 0, blockedSkipped: 0, blockedFailed: 0, blockedWait: 0,
            waitSec: 0,
            sample: rows.length ? String(rows[0].goods || '') : '',
            blockedList: []
        };
        const now = Date.now();
        rows.forEach(function (row) {
            const text = skNorm(row.goods);
            const parsed = skParseGoods(row.goods);
            let matched = false;
            for (let i = 0; i < kws.length; i++) {
                if (skKeywordHit(text, kws[i].keyword, parsed)) { matched = true; break; }
            }
            if (!matched) return;
            stat.matched += 1;
            if (row.disabled) {
                stat.blockedDisabled += 1;
                stat.blockedList.push(String(row.goods || '') + '（小抄标记售罄或限购）');
            } else if (skState.done[row.key] === stamp) {
                stat.blockedDone += 1;
                stat.blockedList.push(String(row.goods || '') + '（本场已抢到）');
            } else if (skState.skipped[row.key]) {
                stat.blockedSkipped += 1;
                stat.blockedList.push(String(row.goods || '') + '（本轮已跳过）');
            } else if (skQueueBusy(row, now)) {
                const q = skState.queue[row.key] || {};
                if (q.failed) {
                    stat.blockedFailed += 1;
                    stat.blockedList.push(String(row.goods || '') + '（已试满 ' + SK_MAX_ROUNDS + '×' + SK_MAX_ROUNDS + ' 次放弃）');
                } else {
                    stat.blockedWait += 1;
                    const left = Math.max(0, Math.ceil(((q.retryAt || 0) - now) / 1000));
                    if (!stat.waitSec || left < stat.waitSec) stat.waitSec = left;
                    stat.blockedList.push(String(row.goods || '') + '（' + left + ' 秒后重试）');
                }
            } else {
                stat.ready += 1;
            }
        });
        return stat;
    }

    // 没抢到的时候，把“为什么”打到控制台，方便排查（最多 10 秒一次）
    let skLastDiagAt = 0;
    function skLogDiagnostics(stat, kws) {
        const now = Date.now();
        if (now - skLastDiagAt < 10000) return;
        skLastDiagAt = now;
        try {
            console.log(TAG, '[seckill] 秒杀列表诊断', {
                '已勾选关键词': kws.map(function (k) { return k.label; }),
                '列表项数': stat.total,
                '命中关键词': stat.matched,
                '可以抢': stat.ready,
                '小抄标记售罄或限购': stat.blockedDisabled,
                '本场已抢到': stat.blockedDone,
                '本轮已跳过': stat.blockedSkipped,
                '等待重试': stat.blockedWait,
                '试满放弃': stat.blockedFailed
            });
            if (!stat.matched) {
                console.log(TAG, '[seckill] 当前列表内容:', skRows().map(function (r) {
                    return String(r.goods || '') + (r.disabled ? '（售罄/限购）' : '');
                }));
            } else if (!stat.ready) {
                console.log(TAG, '[seckill] 命中但抢不了的项:', stat.blockedList);
            }
        } catch (e) {}
    }

    // ---- 界面 ----
    function skEnsureStyle() {
        if (!document || !document.head) return;
        if (document.getElementById(SK_STYLE_ID)) return;
        try {
            const style = document.createElement('style');
            style.id = SK_STYLE_ID;
            style.textContent = [
                '#' + SK_BOX_ID + '{box-sizing:border-box;width:100%;margin:2px 0 4px;padding:4px 1px 0;border-top:1px solid rgba(242,222,156,.18)}',
                '#' + SK_BOX_ID + ' .xcExtSkRow{display:block;width:100%;box-sizing:border-box;margin-bottom:3px}',
                '#' + SK_BOX_ID + ' .xcExtSkDivider{height:1px;margin:5px 0;background:linear-gradient(90deg,transparent,rgba(242,222,156,.32),transparent)}',
                '#' + SK_BOX_ID + ' .xcExtSkRow:last-child{margin-bottom:0}',
                '#' + SK_BOX_ID + ' .xcExtSkCell{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;box-sizing:border-box;margin:0}',
                '#' + SK_BOX_ID + ' .xcExtSkName{flex:1 1 auto;min-width:0;font-size:12.5px;color:#f2de9c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:0}',
                // 开关自绘：不再依赖小抄的随机类名（1.5.98 已换名，以后还会再换）
                '#' + SK_BOX_ID + ' .xcExtSkSwitch{position:relative;display:block;flex-shrink:0;margin-left:0;width:52px;height:24px;cursor:pointer}',
                '#' + SK_BOX_ID + ' .xcExtSkSwitch>input{opacity:0;position:absolute;width:1px;height:1px;margin:0;pointer-events:none}',
                '#' + SK_BOX_ID + ' .xcExtSkTrack{position:absolute;top:0;right:0;bottom:0;left:0;border-radius:999px;border:1px solid rgba(242,222,156,.26);background:linear-gradient(180deg,#221e1a 0%,#1a1613 100%);box-shadow:inset 0 1px 3px rgba(0,0,0,.4);cursor:pointer;transition:background .2s ease,border-color .2s ease,box-shadow .2s ease}',
                '#' + SK_BOX_ID + ' .xcExtSkTrack:before{content:"";position:absolute;left:2px;top:2px;width:18px;height:18px;border-radius:50%;background:linear-gradient(180deg,#f5e6b8 0%,#dcc98a 100%);box-shadow:0 1px 3px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.28);transition:transform .2s cubic-bezier(.4,0,.2,1),background .2s ease,box-shadow .2s ease}',
                '#' + SK_BOX_ID + ' .xcExtSkSwitch:hover input:not(:disabled)+.xcExtSkTrack{border-color:rgba(242,222,156,.42)}',
                '#' + SK_BOX_ID + ' .xcExtSkSwitch input:checked+.xcExtSkTrack{background:linear-gradient(180deg,#d4b56a 0%,#b8923f 100%);border-color:rgba(242,222,156,.55);box-shadow:inset 0 1px 0 rgba(255,248,210,.25),0 0 8px rgba(212,181,106,.18)}',
                '#' + SK_BOX_ID + ' .xcExtSkSwitch input:checked+.xcExtSkTrack:before{transform:translateX(28px);background:linear-gradient(180deg,#fffaf0 0%,#f2de9c 100%);box-shadow:0 1px 3px rgba(0,0,0,.3),inset 0 1px 0 rgba(255,255,255,.5)}',
                '#' + SK_BOX_ID + ' .xcExtSkState{position:absolute;top:50%;right:6px;transform:translateY(-50%);color:rgba(169,149,114,.92);font-size:11px;font-weight:600;line-height:1;letter-spacing:.04em;pointer-events:none;text-shadow:0 1px 1px rgba(0,0,0,.28)}',
                '#' + SK_BOX_ID + ' .xcExtSkSwitch input:checked+.xcExtSkTrack+.xcExtSkState{left:6px;right:auto;color:#2a2010;text-shadow:0 1px 0 rgba(255,248,210,.28)}',
                '#' + SK_BOX_ID + ' .xcExtSkSwitch input+.xcExtSkTrack+.xcExtSkState:before{content:"关"}',
                '#' + SK_BOX_ID + ' .xcExtSkSwitch input:checked+.xcExtSkTrack+.xcExtSkState:before{content:"开"}',
                '#' + SK_BOX_ID + ' input[type="text"]{width:100%;box-sizing:border-box;height:24px;padding:0 8px;border:1px solid rgba(242,222,156,.28);border-radius:5px;background:linear-gradient(180deg,#221e1a 0%,#1a1613 100%);color:#f2de9c;font-size:12px;outline:none}',
                '#' + SK_BOX_ID + ' input[type="text"]:focus{border-color:rgba(242,222,156,.65)}',
                '#' + SK_BOX_ID + ' input[type="text"]::placeholder{color:rgba(169,149,114,.55)}',
                '#' + SK_BOX_ID + ' .xcExtSkTags{display:flex;flex-wrap:wrap;gap:3px;width:100%;box-sizing:border-box}',
                '#' + SK_BOX_ID + ' .xcExtSkTag{display:inline-flex;align-items:center;gap:4px;max-width:100%;padding:1px 6px;margin:0;border:1px solid rgba(242,222,156,.28);border-radius:5px;background:rgba(52,47,40,.9);color:#f2de9c;font-size:11.5px;line-height:18px}',
                '#' + SK_BOX_ID + ' .xcExtSkTag>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
                '#' + SK_BOX_ID + ' .xcExtSkTag>button{border:none;background:transparent;color:rgba(169,149,114,.92);font-size:12px;line-height:1;padding:0 0 0 2px;cursor:pointer}',
                '#' + SK_BOX_ID + ' .xcExtSkTag>button:hover{color:#fff1bd}',
                '#' + SK_BOX_ID + ' #' + SK_STATUS_ID + '{width:100%;font-size:11px;line-height:1.5;color:rgba(169,149,114,.92);word-break:break-all}'
            ].join('\n');
            (document.head || document.documentElement).appendChild(style);
        } catch (e) {
            console.debug(TAG, '[seckill] 样式注入失败:', e);
        }
    }

    function skCellHtml(inputId, label, tip, checked) {
        return '<div class="xcExtSkCell" title="' + tip + '">' +
            '<span class="xcExtSkName">' + label + '</span>' +
            '<label class="xcExtSkSwitch">' +
            '<input id="' + inputId + '" type="checkbox"' + (checked ? ' checked' : '') + '>' +
            '<span class="xcExtSkTrack"></span>' +
            '<span class="xcExtSkState"></span>' +
            '</label>' +
            '</div>';
    }

    function skBuildBox() {
        const box = document.createElement('div');
        box.id = SK_BOX_ID;
        box.setAttribute('data-xc-ext-seckill', '1');
        let html = '';
        html += '<div class="xcExtSkRow">' + skCellHtml(
            'xcExtSeckillSwitch',
            '自动购买所选物品',
            '开启后按下面勾选的关键词自动帮抢；每 10 分钟重扫一次秒杀列表，列表刷新后会自动恢复勾选',
            skState.enabled
        ) + '</div>';
        html += '<div class="xcExtSkDivider"></div>';
        SK_ITEMS.forEach(function (it) {
            html += '<div class="xcExtSkRow">' +
                skCellHtml('xcExtSeckillItem_' + it.id, it.label, it.tip, !!skState.items[it.id]) +
                '</div>';
        });
        html += '<div class="xcExtSkRow">' +
            '<input id="' + SK_CUSTOM_ID + '" type="text" maxlength="24" placeholder="自定义关键词，回车添加（如：xx龙珠）">' +
            '</div>';
        html += '<div class="xcExtSkRow xcExtSkTags" id="' + SK_TAGS_ID + '"></div>';
        html += '<div class="xcExtSkRow"><div id="' + SK_STATUS_ID + '">等待秒杀连点数据…</div></div>';
        box.innerHTML = html;

        const switchEl = box.querySelector('#xcExtSeckillSwitch');
        if (switchEl) {
            switchEl.addEventListener('change', function () {
                skState.enabled = !!switchEl.checked;
                skState.pauseUntil = 0;
                if (skState.enabled) {
                    // 重新打开总开关 = 重新开始一轮：清掉队列与跳过记录，让所有命中项重新排队
                    skState.skipped = {};
                    skState.queue = {};
                    skState.nextBuyAt = 0;
                    skClearTryDeadline();
                    skSave();
                    skScan('switch');
                } else {
                    skCancelTarget();
                    skSave();
                    skStatus('自动购买已关闭');
                }
            });
        }
        SK_ITEMS.forEach(function (it) {
            const el = box.querySelector('#xcExtSeckillItem_' + it.id);
            if (!el) return;
            el.addEventListener('change', function () {
                skState.items[it.id] = !!el.checked;
                skSave();
                skScan('keyword');
            });
        });
        const customEl = box.querySelector('#' + SK_CUSTOM_ID);
        if (customEl) {
            customEl.addEventListener('keydown', function (ev) {
                if (ev.key !== 'Enter' && ev.keyCode !== 13) return;
                ev.preventDefault();
                if (skAddCustom(customEl.value)) customEl.value = '';
            });
            customEl.addEventListener('blur', function () {
                if (skAddCustom(customEl.value)) customEl.value = '';
            });
        }
        return box;
    }

    function skEnsureBox() {
        skEnsureStyle();
        const panel = skPanelEl();
        if (!panel) return null;
        let box = document.getElementById(SK_BOX_ID);
        if (box && box.parentNode === panel) return box;
        if (box && box.parentNode) {
            try { box.parentNode.removeChild(box); } catch (e) {}
        }
        try {
            box = skBuildBox();
            // 接在秒杀列表后面（列表是面板里唯一的那个 div）
            const list = skListEl();
            if (list && list.parentNode === panel && list.nextSibling) panel.insertBefore(box, list.nextSibling);
            else panel.appendChild(box);
        } catch (e) {
            console.debug(TAG, '[seckill] 面板注入失败:', e);
            return null;
        }
        skRenderTags();
        return box;
    }

    function skRenderTags() {
        const wrap = document.getElementById(SK_TAGS_ID);
        if (!wrap) return;
        wrap.innerHTML = '';
        skState.custom.forEach(function (kw, index) {
            const tag = document.createElement('span');
            tag.className = 'xcExtSkTag';
            const text = document.createElement('span');
            text.textContent = kw;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = '×';
            btn.title = '删除关键词';
            btn.addEventListener('click', function (ev) {
                ev.preventDefault();
                ev.stopPropagation();
                skRemoveCustom(index);
            });
            tag.appendChild(text);
            tag.appendChild(btn);
            wrap.appendChild(tag);
        });
    }

    function skStatus(text) {
        const el = document.getElementById(SK_STATUS_ID);
        if (el) el.textContent = String(text == null ? '' : text);
    }

    // ---- 勾选 / 取消 ----
    // 小抄 1.5.98 起，勾选秒杀商品会先弹 window.confirm('确定开启以下商品的秒杀连点？…')。
    // 扩展自己派发的勾选必须静默通过，否则自动抢购会卡在弹框上；
    // 真人点出来的确认框照旧显示，并且点了取消会被记下来（本轮不再自动勾这一项）。
    function skNoteConfirmCancel(msg) {
        const text = String(msg || '');
        const m = text.match(/秒杀连点？[\s\S]*?\n\s*\n\s*([^\n]+)/);
        const goods = skNorm(m ? m[1] : '');
        let matched = null;
        if (goods) {
            skRows().forEach(function (row) {
                if (!matched && skNorm(row.goods) === goods) matched = row;
            });
        }
        skState.pauseUntil = Date.now() + SK_PAUSE_MS;
        if (matched) {
            skMarkSkipped(matched, '你在确认框上点了取消');
            return;
        }
        if (skState.targetKey) skState.targetKey = '';
        console.log(TAG, '[seckill] 你在确认框上点了取消，本轮暂停自动勾选');
        skStatus('已取消小抄的确认框，暂停自动勾选 ' + Math.round(SK_PAUSE_MS / 60000) + ' 分钟');
    }

    // 某一项被否掉：permanent=true 表示人工取消（本轮都不再自动勾它），
    // permanent=false 只暂停一小会儿，避免偶发失败把这一项整场拉黑
    function skMarkSkipped(row, note, permanent) {
        if (!row) return;
        if (permanent !== false) skState.skipped[row.key] = true;
        if (skState.targetKey === row.key) skState.targetKey = '';
        if (skState.manualKey === row.key) skState.manualKey = '';
        skClearTryDeadline();
        const waitMs = permanent === false ? 60000 : SK_PAUSE_MS;
        skState.pauseUntil = Date.now() + waitMs;
        console.log(TAG, '[seckill]', note || '跳过该项', row.goods);
        skStatus('已跳过「' + row.goods + '」，暂停自动勾选 ' + Math.round(waitMs / 60000) + ' 分钟');
    }

    function skInstallConfirmHook() {
        try {
            const current = window.confirm;
            if (typeof current !== 'function') return false;
            if (current.__xcExtSeckillConfirm === true) return true;
            const hooked = function (msg) {
                if (skAutoConfirm) return true;               // 扩展自己派的勾选：静默通过
                const ok = current.apply(window, arguments);   // 真人操作：原样弹框
                if (ok === false && String(msg || '').indexOf('秒杀连点') >= 0) skNoteConfirmCancel(msg);
                return ok;
            };
            hooked.__xcExtSeckillConfirm = true;
            try {
                Object.defineProperty(window, 'confirm', {
                    configurable: true, enumerable: true, writable: true, value: hooked
                });
            } catch (e) {
                try { window.confirm = hooked; } catch (e2) {}
            }
            if (window.confirm !== hooked) {
                if (!skState.confirmBlocked) {
                    skState.confirmBlocked = true;
                    console.warn(TAG, '[seckill] 无法接管 window.confirm，自动勾选可能被确认框拦住');
                }
                return false;
            }
            return true;
        } catch (e) {
            return false;
        }
    }

    function skDispatchChange(el) {
        let ev = null;
        try {
            ev = new Event('change', { bubbles: true });
        } catch (e) {
            ev = null;
        }
        if (!ev) {
            try {
                ev = document.createEvent('HTMLEvents');
                ev.initEvent('change', true, true);
            } catch (e2) {
                ev = null;
            }
        }
        if (!ev) return;
        skAutoConfirm = true;
        try {
            // 隔离世界（iPad 油猴常见）里，页面主环境的小抄弹 confirm 时看不到 skAutoConfirm；
            // 用 DOM 事件给页面主环境的 confirm 钩子开一个同步窗口（见 xcPageWorldHooks）。
            try { document.dispatchEvent(new Event('xc-ext-auto-confirm-on')); } catch (e) {}
            el.dispatchEvent(ev);
        } finally {
            skAutoConfirm = false;
            try { document.dispatchEvent(new Event('xc-ext-auto-confirm-off')); } catch (e) {}
        }
    }

    function skCheckRow(row) {
        try {
            row.el.checked = true;
            skDispatchChange(row.el);
            return true;
        } catch (e) {
            console.debug(TAG, '[seckill] 勾选失败:', e);
            return false;
        }
    }

    function skUncheckRow(row) {
        try {
            row.el.checked = false;
            skDispatchChange(row.el);
        } catch (e) {}
    }

    // 关闭开关时把已经交给小抄的任务撤掉（小抄收到 change 后会 clear 自己的秒杀循环）
    function skCancelTarget() {
        const key = skState.targetKey || skState.manualKey;
        const row = skKeyUnchecked(key);
        skState.targetKey = '';
        skState.manualKey = '';
        skClearTryDeadline();
        if (row) skUncheckRow(row);
    }

    // 按行标识找当前面板里的那一行
    function skKeyUnchecked(key) {
        if (!key) return null;
        const rows = skRows();
        for (let i = 0; i < rows.length; i++) {
            if (rows[i].key === key) return rows[i];
        }
        return null;
    }

    // ---- 扫描 ----
    function skScan(reason) {
        try {
            skScanInner(reason);
        } finally {
            skArmWake();
        }
    }

    function skScanInner(reason) {
        skState.scans += 1;
        try {
            skEnsureBox();
        } catch (e) {}
        // 跨场次先重置队列（挂机跨场次的关键）
        skRoundResetIfNeeded();
        // 面板内容有更新（服务器推了新数据）→ 撤销放弃/跳过，重新排队
        skPanelChangedReset();
        // 10 分钟强制刷新期间不要动状态，等它松手（约 1.5 秒）
        if (skState.refreshKey) return;
        if (!skState.enabled) {
            skStatus('自动购买已关闭');
            return;
        }
        const kws = skKeywords();
        if (!kws.length) {
            skStatus('还没有勾选任何物品，勾选上面的物品或添加自定义关键词');
            return;
        }
        const rows = skRows();
        if (!rows.length) {
            skStatus('等待秒杀连点数据…（小抄收到游戏推送后这里会自动帮抢）');
            return;
        }
        const now = Date.now();

        // 1) 之前交给小抄的那一项：列表重建后恢复勾选；抢完 / 限购满 / 列表里没了就结束
        if (skState.targetKey) {
            const target = skKeyUnchecked(skState.targetKey);
            const isManual = !!(target && skState.manualKey === target.key);
            if (!target) {
                skState.done[skState.targetKey] = skState.roundStamp;
                skState.targetKey = '';
                skClearTryDeadline();
            } else if (target.disabled) {
                skState.done[target.key] = skState.roundStamp;
                skState.targetKey = '';
                skState.manualKey = '';
                skClearTryDeadline();
            } else if (!isManual && skState.tryDeadline && now > skState.tryDeadline) {
                // 开抢后给小抄约 3 次尝试机会，还没抢到就跳下一个（30 秒后回头再试，最多 3 轮）
                skEndRound(target, '尝试 3 次没抢到');
            } else {
                // 列表重建会把勾选冲掉；小抄的排程按 key 覆盖（fr.set 会先 clear 同 key 的任务），
                // 所以这里重新勾选一次即可恢复显示，也能顺带把可能被清掉的排程补回来。
                if (!target.el.checked) skCheckRow(target);
                if (isManual) {
                    // 手动选的项不套“3 次尝试”规则
                    skClearTryDeadline();
                    skStatus('按你的手动选择：' + target.goods);
                } else {
                    skArmTryDeadline(target);
                    skStatus('正在帮抢：' + target.goods + '（' + skTimeLabel(target.startMs) + ' 开抢）' +
                        (skState.tryDeadline > now ? '，本轮最多尝试 3 次' : ''));
                }
                return;
            }
        }

        // 2) 用户手动勾选的物品优先，扩展不覆盖
        if (skState.manualKey) {
            const manual = skKeyUnchecked(skState.manualKey);
            if (manual && !manual.disabled) {
                if (!manual.el.checked) manual.el.checked = true;
                skClearTryDeadline();
                skStatus('按你的手动选择：' + manual.goods);
                return;
            }
            skState.manualKey = '';
        }

        // 3) 用户刚手动取消过，暂停一轮
        if (now < skState.pauseUntil) {
            const left = Math.max(1, Math.ceil((skState.pauseUntil - now) / 60000));
            skStatus('已手动取消，暂停自动勾选（约 ' + left + ' 分钟后恢复）');
            return;
        }

        // 3.5) 刚抢到一件，冷却 3 秒再抢队列里的下一件
        if (now < skState.nextBuyAt) {
            const left = Math.max(1, Math.ceil((skState.nextBuyAt - now) / 1000));
            skStatus('刚抢到一件，' + left + ' 秒后继续抢下一件');
            return;
        }

        // 4) 按开抢时间排队，挑一个现在就能抢的命中项
        const hits = skHits();
        if (!hits.length) {
            const stat = skClassify();
            if (!stat.matched) {
                skStatus('列表 ' + stat.total + ' 项没有命中关键词（已勾选：' +
                    kws.map(function (k) { return k.label; }).join('/') + '）示例：' + stat.sample);
            } else if (stat.blockedWait) {
                skStatus('队列还有 ' + stat.blockedWait + ' 项在等重试（最近 ' + stat.waitSec + ' 秒后）；已抢到 ' +
                    stat.blockedDone + '，售罄或限购 ' + stat.blockedDisabled + '，试满放弃 ' + stat.blockedFailed);
            } else {
                skStatus('队列已清空：已抢到 ' + stat.blockedDone + '，售罄或限购 ' + stat.blockedDisabled +
                    '，试满 ' + SK_MAX_ROUNDS + '×' + SK_MAX_ROUNDS + ' 次放弃 ' + stat.blockedFailed +
                    '，本轮已跳过 ' + stat.blockedSkipped);
            }
            skLogDiagnostics(stat, kws);
            return;
        }
        const pick = hits[0];
        if (pick.row.key !== skState.targetKey) {
            skInstallConfirmHook();
            if (!skCheckRow(pick.row)) {
                skStatus('勾选失败，请手动点一下秒杀列表');
                return;
            }
            if (pick.row.el.checked !== true) {
                // 小抄 1.5.98 的确认框没放行（接管失败或被人取消）：只短暂停一下，不拉黑这一项
                skMarkSkipped(pick.row, '自动勾选没有生效（确认框未放行）', false);
                return;
            }
            skState.targetKey = pick.row.key;
            skArmTryDeadline(pick.row);
            console.log(TAG, '[seckill] 已自动勾选:', pick.row.goods, '命中关键词:', pick.kw.label, '原因:', reason || 'scan');
        }
        skStatus('正在帮抢：' + pick.row.goods + '（' + skTimeLabel(pick.row.startMs) + ' 开抢）' +
            (hits.length > 1 ? '，队列里还有 ' + (hits.length - 1) + ' 项' : '') +
            (skState.tryDeadline > Date.now() ? '，本轮最多尝试 3 次' : '') +
            (skState.confirmBlocked ? '（确认框接管失败，可能需要手动确认）' : ''));
    }

    // 给小抄约 3 次购买尝试的机会（从开抢时间算起，小抄每 300ms 重试一次）
    function skArmTryDeadline(row) {
        const now = Date.now();
        const rowKey = (row && row.key) || '';
        if (!skState.tryDeadline || skState.tryRowKey !== rowKey) {
            const startAt = Math.max(now, Number(row && row.startMs) || now);
            skState.tryDeadline = startAt + SK_TRY_MS;
            skState.tryRowKey = rowKey;
        }
        const deadline = skState.tryDeadline;
        if (skTryTimer) {
            clearTimeout(skTryTimer);
            skTryTimer = 0;
        }
        skTryTimer = setTimeout(function () {
            skTryTimer = 0;
            // 期间可能已经换了目标 / 已抢到，旧计时器直接作废
            if (!skState.targetKey || skState.targetKey !== rowKey) return;
            if (skState.tryDeadline !== deadline) return;
            const target = skKeyUnchecked(skState.targetKey);
            if (target && !target.disabled && Date.now() >= deadline) {
                skEndRound(target, '尝试 3 次没抢到');
            }
            skScan('give-up');
        }, Math.max(0, deadline - now) + 50);
    }

    function skClearTryDeadline() {
        skState.tryDeadline = 0;
        skState.tryRowKey = '';
        if (skTryTimer) {
            clearTimeout(skTryTimer);
            skTryTimer = 0;
        }
    }

    // 放弃当前项：撤掉勾选让小抄停掉它的循环，并记下来不再重复抢这一项
    // 一轮（约 3 次尝试）没抢到：先跳下一个，30 秒后回头再试；试满 3 轮（9 次）就彻底放弃
    function skEndRound(row, note) {
        const key = (row && row.key) || skState.targetKey;
        if (!key) return;
        const st = skQueueState(key, true);
        st.rounds += 1;
        st.retryAt = 0;
        let extra = '';
        if (st.rounds >= SK_MAX_ROUNDS) {
            st.failed = true;
            extra = '，已试满 ' + SK_MAX_ROUNDS + '×' + SK_MAX_ROUNDS + ' 次，放弃该项';
        } else {
            st.retryAt = Date.now() + SK_RETRY_MS;
            extra = '，' + Math.round(SK_RETRY_MS / 1000) + ' 秒后重试（第 ' + (st.rounds + 1) + ' 轮）';
        }
        skState.targetKey = '';
        skClearTryDeadline();
        if (row) skUncheckRow(row);
        console.log(TAG, '[seckill]', (note || '一轮没抢到'), row ? row.goods : '', extra);
        if (row) skStatus('「' + row.goods + '」' + (note || '一轮没抢到') + extra);
    }

    // 每一项在队列里的状态（rounds / 下次重试时间 / 是否已放弃）
    function skQueueState(key, create) {
        if (!key) return null;
        let st = skState.queue[key];
        if (!st && create) {
            st = { rounds: 0, retryAt: 0, failed: false };
            skState.queue[key] = st;
        }
        return st || null;
    }

    function skQueueBusy(row, now) {
        const st = skState.queue[row.key];
        if (!st) return false;
        if (st.failed) return true;
        if (st.retryAt && st.retryAt > now) return true;
        return false;
    }

    // 队列里最早需要“再做点什么”的时间：重试用、冷却用、尝试窗口用
    let skWakeTimer = 0;
    function skArmWake() {
        if (skWakeTimer) {
            clearTimeout(skWakeTimer);
            skWakeTimer = 0;
        }
        const now = Date.now();
        let at = 0;
        const push = function (t) {
            if (t && t > now && (!at || t < at)) at = t;
        };
        if (skState.targetKey && skState.tryDeadline) push(skState.tryDeadline);
        if (skState.enabled) {
            if (skState.nextBuyAt) push(skState.nextBuyAt);
            if (skState.pauseUntil) push(skState.pauseUntil);
            skRows().forEach(function (row) {
                const st = skState.queue[row.key];
                if (st && !st.failed && st.retryAt) push(st.retryAt);
            });
        }
        if (!at) return;
        skWakeTimer = setTimeout(function () {
            skWakeTimer = 0;
            skScan('wake');
        }, Math.max(0, at - now) + 50);
    }

    // ---- 抢到成功 / 手动操作 监听 ----
    function skOnChange(ev) {
        const el = ev && ev.target;
        if (!el || el.tagName !== 'INPUT' || !el.matches) return;
        let isSeckill = false;
        try {
            isSeckill = el.matches('input[type="checkbox"][data-seckill="true"]');
        } catch (e) {
            return;
        }
        if (!isSeckill) return;
        const row = skRowOf(el);
        if (ev.isTrusted) {
            // 真人操作：以手动为准
            if (el.checked) {
                skState.manualKey = row.key;
                skState.targetKey = row.key;
                skState.pauseUntil = 0;
                skClearTryDeadline();   // 手动选的项不套“3 次尝试”规则
                skStatus('按你的手动选择：' + row.goods);
            } else {
                if (row.key === skState.targetKey) skState.targetKey = '';
                if (row.key === skState.manualKey) skState.manualKey = '';
                skState.skipped[row.key] = true;
                skState.pauseUntil = Date.now() + SK_PAUSE_MS;
                skClearTryDeadline();
                skStatus('已手动取消，暂停自动勾选 ' + Math.round(SK_PAUSE_MS / 60000) + ' 分钟');
            }
            return;
        }
        // 扩展自己勾的：小抄会在这里清掉其它勾选，记一下状态即可
        if (el.checked) skState.targetKey = row.key;
    }

    function skOnSuccessToast(text) {
        // 小抄原文案：秒杀抢购成功！已抢到「物品名」，其中物品名就是该行的 goods 文本
        if (String(text || '').indexOf('秒杀抢购成功') < 0) return;
        const m = String(text || '').match(/已抢到[「“"]([^」”"]+)[」”"]/);
        const want = skNorm(m ? m[1] : '');
        if (!want) return;
        const finish = function (key) {
            if (!key) return false;
            skState.done[key] = skState.roundStamp;
            // 抢到就出队，并冷却 3 秒再抢下一件
            delete skState.queue[key];
            skState.nextBuyAt = Date.now() + SK_BUY_COOLDOWN_MS;
            if (skState.targetKey === key) skState.targetKey = '';
            if (skState.manualKey === key) skState.manualKey = '';
            skClearTryDeadline();
            return true;
        };
        // 只结束对应这一项（同名商品在不同场次各算一项，不能一次全标记掉）
        const targetRow = skKeyUnchecked(skState.targetKey);
        if (skState.targetKey && (!targetRow || skNorm(targetRow.goods) === want)) {
            finish(skState.targetKey);
            skSave();
            skScan('grabbed');
            return;
        }
        const manualRow = skKeyUnchecked(skState.manualKey);
        if (skState.manualKey && manualRow && skNorm(manualRow.goods) === want) {
            finish(skState.manualKey);
            skSave();
            skScan('grabbed');
            return;
        }
        let changed = false;
        skRows().forEach(function (row) {
            if (skNorm(row.goods) === want && finish(row.key)) changed = true;
        });
        if (changed) {
            skSave();
            skScan('grabbed');
        }
    }

    function skWatchToasts(records) {
        for (let i = 0; i < records.length; i++) {
            const added = records[i].addedNodes || [];
            for (let j = 0; j < added.length; j++) {
                const node = added[j];
                if (!node) continue;
                const text = node.nodeType === 1 ? (node.textContent || '') : '';
                if (text.indexOf('秒杀抢购成功') >= 0) skOnSuccessToast(text);
            }
        }
    }

    // ---- 轮询 / 观察 ----
    function skScheduleScan(delay) {
        if (skScanTimer) return;
        skScanTimer = setTimeout(function () {
            skScanTimer = 0;
            skScan('list');
        }, delay == null ? 200 : delay);
    }

    function skBindObserver() {
        const panel = skPanelEl();
        if (!panel) return false;
        if (skObserver && skObserverTarget === panel) return true;
        if (skObserver) {
            try { skObserver.disconnect(); } catch (e) {}
            skObserver = null;
            skObserverTarget = null;
        }
        try {
            skObserver = new MutationObserver(function () { skScheduleScan(200); });
            skObserver.observe(panel, { childList: true, subtree: true });
            skObserverTarget = panel;
            return true;
        } catch (e) {
            skObserver = null;
            skObserverTarget = null;
            return false;
        }
    }

    // 兜底：跟着主脚本的 3 秒重装一起跑，列表被整体替换时也能发现
    function skTick() {
        skEnsureStyle();
        skInstallConfirmHook();
        skRoundResetIfNeeded();
        const panel = skPanelEl();
        if (!panel) return;
        skEnsureBox();
        skBindObserver();
        const rows = skRows();
        const signature = rows.length + '#' + rows.map(function (r) {
            return r.key + (r.el.checked ? '1' : '0') + (r.disabled ? 'd' : '');
        }).join(',');
        if (signature !== skState.signature) {
            skState.signature = signature;
            // 观察器是快速通道，这里再兜一层：列表被整体替换 / 观察器失效时也能重扫
            skScheduleScan(200);
        }
        // 再兜一层：到了“3 次尝试”的截止时间还没结果，也要及时换下一个
        if (skState.targetKey && skState.tryDeadline && Date.now() > skState.tryDeadline) {
            skScheduleScan(50);
        }
    }

    function skInstall() {
        if (!document || typeof document.addEventListener !== 'function') return;
        if (document.__xcExtSeckillBound === true) return;
        document.__xcExtSeckillBound = true;
        // 捕获阶段先于小抄自己的 change 处理器执行，用来识别真人操作（isTrusted）
        document.addEventListener('change', skOnChange, true);
        // 小抄 1.5.98 起勾选会弹确认框，这里接管以便自动勾选静默通过
        skInstallConfirmHook();
        try {
            const toastObserver = new MutationObserver(skWatchToasts);
            toastObserver.observe(document, { childList: true, subtree: true });
        } catch (e) {
            console.debug(TAG, '[seckill] 抢购结果监听安装失败:', e);
        }
        // 每 10 分钟：先强制刷新一次（拉最新数据），再重扫排队
        setInterval(function () {
            try { skForceRefresh(); } catch (e) { console.debug(TAG, '[seckill] 强制刷新异常:', e); }
            skScan('timer');
        }, SK_SCAN_MS);
        setInterval(skTick, SK_TICK_MS);
        [80, 300, 900, 2000, 5000].forEach(function (t) {
            setTimeout(function () { skEnsureBox(); skScan('startup'); }, t);
        });
        console.log(TAG, '秒杀自动购买模块已启动（每 ' + Math.round(SK_SCAN_MS / 60000) + ' 分钟重扫一次秒杀列表）');
    }

    // 秒杀模块的样式与设置（设置读一次即可，运行期由事件负责保存）
    skLoad();
    skEnsureStyle();
    skInstall();


    // ============ 12.【功能 4】95折充值（官服 95 折扫码充值）============
    // 自动读取账号 / 玩家ID / 昵称 / 设备ID，配合固定字段调用官方 ol-payment 出码接口：
    //   - 支付宝：内嵌收银台页面并整体缩放，直接显示最终付款码（扫一次即可，不用二次跳转）
    //   - 微信：接口直接返回 base64 图片
    // 自带独立命名空间，不改动小抄内部代码，也不影响本拓展的其他功能。
    var xcRecharge = (function () {
        var TAG = '[95Pay]';
        // 只有官服才有 95 折通道（channel=210000），其他渠道一律不渲染（@match 与拓展保持一致，方便以后整段搬过去）
        var IS_OFFICIAL = /(^|\.)sanguosha\.com$/i.test(location.hostname);

        // ================= 配置 =================
        var PAY_BASE = 'https://ol-payment.sanguosha.com/v1/';
        var PAY_SECRET = 'IqCUMcHyvGTtw4ThpEky5jtjEl8PG0V5';
        var FIXED = { server_id: 1100, channel: '210000', device_model: 'NoDeviceName', osType: 12 };
        var YB_PRESETS = [1, 200, 600, 3000, 6000, 12800, 32800, 64800];
        var QR_ECC = 'M';               // 实测：ECC-M 在 v1–v30 全部可解；ECC-L 在 v23 会被部分识别库解不出
        var QR_QUIET = 4;               // 静默区模块数
        var QR_MIN_MODULE_PX = 2;       // 低于 2px/模块就不在面板里画，改给链接
        var QR_MAX_MODULE_PX = 6;
        // 支付宝收银台页面里那张「最终付款码」的位置与尺寸（实测：左上角 (8,4) 处 170x170，不随窗口变化）。
        // 我们把这页整体缩放（transform:scale）来放大它——Chrome 会按缩放后的尺寸重新栅格化，放出来是锐利的。
        var CASHIER_QR_BASE = 170;
        var CASHIER_QR_X = 8;
        var CASHIER_QR_Y = 4;
        var CASHIER_QR_PAD = 8;         // 码四周留多少屏幕像素的白边（白卡本身另外还有 8px 内边距）
        // 沙箱：允许脚本和自身源，但不给 top-navigation，避免支付宝页面把整个游戏页顶走
        var CASHIER_SANDBOX = 'allow-scripts allow-same-origin';
        // 服务端不校验等级，固定发一个常量即可（输入框已按需求移除）
        var USER_LEVEL_FIXED = 200;
        var REQ_TIMEOUT_MS = 15000;

        var STORAGE_KEY = 'xcExt:recharge95';
        var STYLE_ID = 'xc95Style';
        var BTN_ID = 'xc95Btn';
        var PANEL_ID = 'xc95Panel';
        var RESULT_ID = 'xc95Result';
        var QRBOX_ID = 'xc95QrBox';
        var QR_CARD_ID = 'xc95QrCard';
        var TIP_ID = 'xc95Tip';
        var META_ID = 'xc95Meta';
        var STATUS_ID = 'xc95Status';
        var COPY_ID = 'xc95Copy';
        var OPEN_ID = 'xc95Open';
        var BACKUP_ID = 'xc95Backup';
        var ZOOM_ID = 'xc95Zoom';
        var ZOOM_BTN_ID = 'xc95ZoomBtn';

        var BTN_TEXT = '95折充值';

        // ================= 状态 =================
        var st = {
            account: '', userId: '', nickname: '',
            yb: '3000',
            busy: false,
            last: null,
            auto: { account: '', userId: '', nickname: '' }
        };

        function trim(v) { return String(v == null ? '' : v).trim(); }
        function safe(fn, fallback) {
            try { var r = fn(); return r === undefined ? fallback : r; } catch (e) { return fallback; }
        }
        function $(id) { return document.getElementById(id); }

        /* =======================================================================
         * MD5（RFC 1321，纯 JS；浏览器 WebCrypto 不提供 MD5）
         * 已用 Node crypto 逐字节校验，并与服务端实际接受的签名对过
         * ===================================================================== */
        function utf8Bytes(str) {
            if (typeof TextEncoder === 'function') return new TextEncoder().encode(str);
            var out = [], i, c;
            for (i = 0; i < str.length; i++) {
                c = str.charCodeAt(i);
                if (c < 0x80) out.push(c);
                else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
                else if (c >= 0xd800 && c <= 0xdbff) {
                    var c2 = str.charCodeAt(++i);
                    var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
                    out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
                } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
            }
            return new Uint8Array(out);
        }

        function md5Bytes(bytes) {
            var K = new Int32Array(64), S = new Int32Array(64);
            var sList = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
                5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
                4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
                6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
            for (var i = 0; i < 64; i++) {
                K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
                S[i] = sList[i];
            }
            var len = bytes.length, bitLen = len * 8;
            var withPad = Math.ceil((len + 9) / 64) * 64;
            var buf = new Uint8Array(withPad);
            buf.set(bytes);
            buf[len] = 0x80;
            var lo = bitLen >>> 0, hi = Math.floor(bitLen / 4294967296) >>> 0;
            buf[withPad - 8] = lo & 255; buf[withPad - 7] = (lo >>> 8) & 255;
            buf[withPad - 6] = (lo >>> 16) & 255; buf[withPad - 5] = (lo >>> 24) & 255;
            buf[withPad - 4] = hi & 255; buf[withPad - 3] = (hi >>> 8) & 255;
            buf[withPad - 2] = (hi >>> 16) & 255; buf[withPad - 1] = (hi >>> 24) & 255;

            var a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
            var M = new Int32Array(16);
            for (var off = 0; off < withPad; off += 64) {
                for (var j = 0; j < 16; j++) {
                    M[j] = buf[off + j * 4] | (buf[off + j * 4 + 1] << 8) |
                        (buf[off + j * 4 + 2] << 16) | (buf[off + j * 4 + 3] << 24);
                }
                var A = a0, B = b0, C = c0, D = d0;
                for (var k = 0; k < 64; k++) {
                    var F, g;
                    if (k < 16) { F = (B & C) | (~B & D); g = k; }
                    else if (k < 32) { F = (D & B) | (~D & C); g = (5 * k + 1) % 16; }
                    else if (k < 48) { F = B ^ C ^ D; g = (3 * k + 5) % 16; }
                    else { F = C ^ (B | ~D); g = (7 * k) % 16; }
                    F = (F + A + K[k] + M[g]) | 0;
                    A = D; D = C; C = B;
                    B = (B + ((F << S[k]) | (F >>> (32 - S[k])))) | 0;
                }
                a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
            }
            return [a0, b0, c0, d0];
        }

        function leHex(n) {
            var s = '';
            for (var i = 0; i < 4; i++) {
                var b = ((n >>> (i * 8)) & 255).toString(16);
                s += b.length < 2 ? '0' + b : b;
            }
            return s;
        }

        function md5Hex(str) {
            var h = md5Bytes(utf8Bytes(str));
            return (leHex(h[0]) + leHex(h[1]) + leHex(h[2]) + leHex(h[3])).toUpperCase();
        }

        /* =======================================================================
         * 二维码编码器：qrcode-generator v1.4.4
         * Copyright (c) 2009 Kazuhiko Arase — MIT License
         * 已做离线回环校验（生成后用 jsQR / zxing 双解码器回读一致）
         * ===================================================================== */
        var qrcode = (function () {
            var module = { exports: {} };
            var exports = module.exports;
            var define = undefined;   // 防止宿主页面的 AMD loader 截走 factory
            var qrcode=function(){var t=function(t,r){var e=t,n=g[r],o=null,i=0,a=null,u=[],f={},c=function(t,r){o=function(t){for(var r=new Array(t),e=0;e<t;e+=1){r[e]=new Array(t);for(var n=0;n<t;n+=1)r[e][n]=null}return r}(i=4*e+17),l(0,0),l(i-7,0),l(0,i-7),s(),h(),d(t,r),e>=7&&v(t),null==a&&(a=p(e,n,u)),w(a,r)},l=function(t,r){for(var e=-1;e<=7;e+=1)if(!(t+e<=-1||i<=t+e))for(var n=-1;n<=7;n+=1)r+n<=-1||i<=r+n||(o[t+e][r+n]=0<=e&&e<=6&&(0==n||6==n)||0<=n&&n<=6&&(0==e||6==e)||2<=e&&e<=4&&2<=n&&n<=4)},h=function(){for(var t=8;t<i-8;t+=1)null==o[t][6]&&(o[t][6]=t%2==0);for(var r=8;r<i-8;r+=1)null==o[6][r]&&(o[6][r]=r%2==0)},s=function(){for(var t=B.getPatternPosition(e),r=0;r<t.length;r+=1)for(var n=0;n<t.length;n+=1){var i=t[r],a=t[n];if(null==o[i][a])for(var u=-2;u<=2;u+=1)for(var f=-2;f<=2;f+=1)o[i+u][a+f]=-2==u||2==u||-2==f||2==f||0==u&&0==f}},v=function(t){for(var r=B.getBCHTypeNumber(e),n=0;n<18;n+=1){var a=!t&&1==(r>>n&1);o[Math.floor(n/3)][n%3+i-8-3]=a}for(n=0;n<18;n+=1){a=!t&&1==(r>>n&1);o[n%3+i-8-3][Math.floor(n/3)]=a}},d=function(t,r){for(var e=n<<3|r,a=B.getBCHTypeInfo(e),u=0;u<15;u+=1){var f=!t&&1==(a>>u&1);u<6?o[u][8]=f:u<8?o[u+1][8]=f:o[i-15+u][8]=f}for(u=0;u<15;u+=1){f=!t&&1==(a>>u&1);u<8?o[8][i-u-1]=f:u<9?o[8][15-u-1+1]=f:o[8][15-u-1]=f}o[i-8][8]=!t},w=function(t,r){for(var e=-1,n=i-1,a=7,u=0,f=B.getMaskFunction(r),c=i-1;c>0;c-=2)for(6==c&&(c-=1);;){for(var g=0;g<2;g+=1)if(null==o[n][c-g]){var l=!1;u<t.length&&(l=1==(t[u]>>>a&1)),f(n,c-g)&&(l=!l),o[n][c-g]=l,-1==(a-=1)&&(u+=1,a=7)}if((n+=e)<0||i<=n){n-=e,e=-e;break}}},p=function(t,r,e){for(var n=A.getRSBlocks(t,r),o=b(),i=0;i<e.length;i+=1){var a=e[i];o.put(a.getMode(),4),o.put(a.getLength(),B.getLengthInBits(a.getMode(),t)),a.write(o)}var u=0;for(i=0;i<n.length;i+=1)u+=n[i].dataCount;if(o.getLengthInBits()>8*u)throw"code length overflow. ("+o.getLengthInBits()+">"+8*u+")";for(o.getLengthInBits()+4<=8*u&&o.put(0,4);o.getLengthInBits()%8!=0;)o.putBit(!1);for(;!(o.getLengthInBits()>=8*u||(o.put(236,8),o.getLengthInBits()>=8*u));)o.put(17,8);return function(t,r){for(var e=0,n=0,o=0,i=new Array(r.length),a=new Array(r.length),u=0;u<r.length;u+=1){var f=r[u].dataCount,c=r[u].totalCount-f;n=Math.max(n,f),o=Math.max(o,c),i[u]=new Array(f);for(var g=0;g<i[u].length;g+=1)i[u][g]=255&t.getBuffer()[g+e];e+=f;var l=B.getErrorCorrectPolynomial(c),h=k(i[u],l.getLength()-1).mod(l);for(a[u]=new Array(l.getLength()-1),g=0;g<a[u].length;g+=1){var s=g+h.getLength()-a[u].length;a[u][g]=s>=0?h.getAt(s):0}}var v=0;for(g=0;g<r.length;g+=1)v+=r[g].totalCount;var d=new Array(v),w=0;for(g=0;g<n;g+=1)for(u=0;u<r.length;u+=1)g<i[u].length&&(d[w]=i[u][g],w+=1);for(g=0;g<o;g+=1)for(u=0;u<r.length;u+=1)g<a[u].length&&(d[w]=a[u][g],w+=1);return d}(o,n)};f.addData=function(t,r){var e=null;switch(r=r||"Byte"){case"Numeric":e=M(t);break;case"Alphanumeric":e=x(t);break;case"Byte":e=m(t);break;case"Kanji":e=L(t);break;default:throw"mode:"+r}u.push(e),a=null},f.isDark=function(t,r){if(t<0||i<=t||r<0||i<=r)throw t+","+r;return o[t][r]},f.getModuleCount=function(){return i},f.make=function(){if(e<1){for(var t=1;t<40;t++){for(var r=A.getRSBlocks(t,n),o=b(),i=0;i<u.length;i++){var a=u[i];o.put(a.getMode(),4),o.put(a.getLength(),B.getLengthInBits(a.getMode(),t)),a.write(o)}var g=0;for(i=0;i<r.length;i++)g+=r[i].dataCount;if(o.getLengthInBits()<=8*g)break}e=t}c(!1,function(){for(var t=0,r=0,e=0;e<8;e+=1){c(!0,e);var n=B.getLostPoint(f);(0==e||t>n)&&(t=n,r=e)}return r}())},f.createTableTag=function(t,r){t=t||2;var e="";e+='<table style="',e+=" border-width: 0px; border-style: none;",e+=" border-collapse: collapse;",e+=" padding: 0px; margin: "+(r=void 0===r?4*t:r)+"px;",e+='">',e+="<tbody>";for(var n=0;n<f.getModuleCount();n+=1){e+="<tr>";for(var o=0;o<f.getModuleCount();o+=1)e+='<td style="',e+=" border-width: 0px; border-style: none;",e+=" border-collapse: collapse;",e+=" padding: 0px; margin: 0px;",e+=" width: "+t+"px;",e+=" height: "+t+"px;",e+=" background-color: ",e+=f.isDark(n,o)?"#000000":"#ffffff",e+=";",e+='"/>';e+="</tr>"}return e+="</tbody>",e+="</table>"},f.createSvgTag=function(t,r,e,n){var o={};"object"==typeof arguments[0]&&(t=(o=arguments[0]).cellSize,r=o.margin,e=o.alt,n=o.title),t=t||2,r=void 0===r?4*t:r,(e="string"==typeof e?{text:e}:e||{}).text=e.text||null,e.id=e.text?e.id||"qrcode-description":null,(n="string"==typeof n?{text:n}:n||{}).text=n.text||null,n.id=n.text?n.id||"qrcode-title":null;var i,a,u,c,g=f.getModuleCount()*t+2*r,l="";for(c="l"+t+",0 0,"+t+" -"+t+",0 0,-"+t+"z ",l+='<svg version="1.1" xmlns="http://www.w3.org/2000/svg"',l+=o.scalable?"":' width="'+g+'px" height="'+g+'px"',l+=' viewBox="0 0 '+g+" "+g+'" ',l+=' preserveAspectRatio="xMinYMin meet"',l+=n.text||e.text?' role="img" aria-labelledby="'+y([n.id,e.id].join(" ").trim())+'"':"",l+=">",l+=n.text?'<title id="'+y(n.id)+'">'+y(n.text)+"</title>":"",l+=e.text?'<description id="'+y(e.id)+'">'+y(e.text)+"</description>":"",l+='<rect width="100%" height="100%" fill="white" cx="0" cy="0"/>',l+='<path d="',a=0;a<f.getModuleCount();a+=1)for(u=a*t+r,i=0;i<f.getModuleCount();i+=1)f.isDark(a,i)&&(l+="M"+(i*t+r)+","+u+c);return l+='" stroke="transparent" fill="black"/>',l+="</svg>"},f.createDataURL=function(t,r){t=t||2,r=void 0===r?4*t:r;var e=f.getModuleCount()*t+2*r,n=r,o=e-r;return I(e,e,(function(r,e){if(n<=r&&r<o&&n<=e&&e<o){var i=Math.floor((r-n)/t),a=Math.floor((e-n)/t);return f.isDark(a,i)?0:1}return 1}))},f.createImgTag=function(t,r,e){t=t||2,r=void 0===r?4*t:r;var n=f.getModuleCount()*t+2*r,o="";return o+="<img",o+=' src="',o+=f.createDataURL(t,r),o+='"',o+=' width="',o+=n,o+='"',o+=' height="',o+=n,o+='"',e&&(o+=' alt="',o+=y(e),o+='"'),o+="/>"};var y=function(t){for(var r="",e=0;e<t.length;e+=1){var n=t.charAt(e);switch(n){case"<":r+="&lt;";break;case">":r+="&gt;";break;case"&":r+="&amp;";break;case'"':r+="&quot;";break;default:r+=n}}return r};return f.createASCII=function(t,r){if((t=t||1)<2)return function(t){t=void 0===t?2:t;var r,e,n,o,i,a=1*f.getModuleCount()+2*t,u=t,c=a-t,g={"██":"█","█ ":"▀"," █":"▄","  ":" "},l={"██":"▀","█ ":"▀"," █":" ","  ":" "},h="";for(r=0;r<a;r+=2){for(n=Math.floor((r-u)/1),o=Math.floor((r+1-u)/1),e=0;e<a;e+=1)i="█",u<=e&&e<c&&u<=r&&r<c&&f.isDark(n,Math.floor((e-u)/1))&&(i=" "),u<=e&&e<c&&u<=r+1&&r+1<c&&f.isDark(o,Math.floor((e-u)/1))?i+=" ":i+="█",h+=t<1&&r+1>=c?l[i]:g[i];h+="\n"}return a%2&&t>0?h.substring(0,h.length-a-1)+Array(a+1).join("▀"):h.substring(0,h.length-1)}(r);t-=1,r=void 0===r?2*t:r;var e,n,o,i,a=f.getModuleCount()*t+2*r,u=r,c=a-r,g=Array(t+1).join("██"),l=Array(t+1).join("  "),h="",s="";for(e=0;e<a;e+=1){for(o=Math.floor((e-u)/t),s="",n=0;n<a;n+=1)i=1,u<=n&&n<c&&u<=e&&e<c&&f.isDark(o,Math.floor((n-u)/t))&&(i=0),s+=i?g:l;for(o=0;o<t;o+=1)h+=s+"\n"}return h.substring(0,h.length-1)},f.renderTo2dContext=function(t,r){r=r||2;for(var e=f.getModuleCount(),n=0;n<e;n++)for(var o=0;o<e;o++)t.fillStyle=f.isDark(n,o)?"black":"white",t.fillRect(n*r,o*r,r,r)},f};t.stringToBytes=(t.stringToBytesFuncs={default:function(t){for(var r=[],e=0;e<t.length;e+=1){var n=t.charCodeAt(e);r.push(255&n)}return r}}).default,t.createStringToBytes=function(t,r){var e=function(){for(var e=S(t),n=function(){var t=e.read();if(-1==t)throw"eof";return t},o=0,i={};;){var a=e.read();if(-1==a)break;var u=n(),f=n()<<8|n();i[String.fromCharCode(a<<8|u)]=f,o+=1}if(o!=r)throw o+" != "+r;return i}(),n="?".charCodeAt(0);return function(t){for(var r=[],o=0;o<t.length;o+=1){var i=t.charCodeAt(o);if(i<128)r.push(i);else{var a=e[t.charAt(o)];"number"==typeof a?(255&a)==a?r.push(a):(r.push(a>>>8),r.push(255&a)):r.push(n)}}return r}};var r,e,n,o,i,a=1,u=2,f=4,c=8,g={L:1,M:0,Q:3,H:2},l=0,h=1,s=2,v=3,d=4,w=5,p=6,y=7,B=(r=[[],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50],[6,30,54],[6,32,58],[6,34,62],[6,26,46,66],[6,26,48,70],[6,26,50,74],[6,30,54,78],[6,30,56,82],[6,30,58,86],[6,34,62,90],[6,28,50,72,94],[6,26,50,74,98],[6,30,54,78,102],[6,28,54,80,106],[6,32,58,84,110],[6,30,58,86,114],[6,34,62,90,118],[6,26,50,74,98,122],[6,30,54,78,102,126],[6,26,52,78,104,130],[6,30,56,82,108,134],[6,34,60,86,112,138],[6,30,58,86,114,142],[6,34,62,90,118,146],[6,30,54,78,102,126,150],[6,24,50,76,102,128,154],[6,28,54,80,106,132,158],[6,32,58,84,110,136,162],[6,26,54,82,110,138,166],[6,30,58,86,114,142,170]],e=1335,n=7973,i=function(t){for(var r=0;0!=t;)r+=1,t>>>=1;return r},(o={}).getBCHTypeInfo=function(t){for(var r=t<<10;i(r)-i(e)>=0;)r^=e<<i(r)-i(e);return 21522^(t<<10|r)},o.getBCHTypeNumber=function(t){for(var r=t<<12;i(r)-i(n)>=0;)r^=n<<i(r)-i(n);return t<<12|r},o.getPatternPosition=function(t){return r[t-1]},o.getMaskFunction=function(t){switch(t){case l:return function(t,r){return(t+r)%2==0};case h:return function(t,r){return t%2==0};case s:return function(t,r){return r%3==0};case v:return function(t,r){return(t+r)%3==0};case d:return function(t,r){return(Math.floor(t/2)+Math.floor(r/3))%2==0};case w:return function(t,r){return t*r%2+t*r%3==0};case p:return function(t,r){return(t*r%2+t*r%3)%2==0};case y:return function(t,r){return(t*r%3+(t+r)%2)%2==0};default:throw"bad maskPattern:"+t}},o.getErrorCorrectPolynomial=function(t){for(var r=k([1],0),e=0;e<t;e+=1)r=r.multiply(k([1,C.gexp(e)],0));return r},o.getLengthInBits=function(t,r){if(1<=r&&r<10)switch(t){case a:return 10;case u:return 9;case f:case c:return 8;default:throw"mode:"+t}else if(r<27)switch(t){case a:return 12;case u:return 11;case f:return 16;case c:return 10;default:throw"mode:"+t}else{if(!(r<41))throw"type:"+r;switch(t){case a:return 14;case u:return 13;case f:return 16;case c:return 12;default:throw"mode:"+t}}},o.getLostPoint=function(t){for(var r=t.getModuleCount(),e=0,n=0;n<r;n+=1)for(var o=0;o<r;o+=1){for(var i=0,a=t.isDark(n,o),u=-1;u<=1;u+=1)if(!(n+u<0||r<=n+u))for(var f=-1;f<=1;f+=1)o+f<0||r<=o+f||0==u&&0==f||a==t.isDark(n+u,o+f)&&(i+=1);i>5&&(e+=3+i-5)}for(n=0;n<r-1;n+=1)for(o=0;o<r-1;o+=1){var c=0;t.isDark(n,o)&&(c+=1),t.isDark(n+1,o)&&(c+=1),t.isDark(n,o+1)&&(c+=1),t.isDark(n+1,o+1)&&(c+=1),0!=c&&4!=c||(e+=3)}for(n=0;n<r;n+=1)for(o=0;o<r-6;o+=1)t.isDark(n,o)&&!t.isDark(n,o+1)&&t.isDark(n,o+2)&&t.isDark(n,o+3)&&t.isDark(n,o+4)&&!t.isDark(n,o+5)&&t.isDark(n,o+6)&&(e+=40);for(o=0;o<r;o+=1)for(n=0;n<r-6;n+=1)t.isDark(n,o)&&!t.isDark(n+1,o)&&t.isDark(n+2,o)&&t.isDark(n+3,o)&&t.isDark(n+4,o)&&!t.isDark(n+5,o)&&t.isDark(n+6,o)&&(e+=40);var g=0;for(o=0;o<r;o+=1)for(n=0;n<r;n+=1)t.isDark(n,o)&&(g+=1);return e+=Math.abs(100*g/r/r-50)/5*10},o),C=function(){for(var t=new Array(256),r=new Array(256),e=0;e<8;e+=1)t[e]=1<<e;for(e=8;e<256;e+=1)t[e]=t[e-4]^t[e-5]^t[e-6]^t[e-8];for(e=0;e<255;e+=1)r[t[e]]=e;var n={glog:function(t){if(t<1)throw"glog("+t+")";return r[t]},gexp:function(r){for(;r<0;)r+=255;for(;r>=256;)r-=255;return t[r]}};return n}();function k(t,r){if(void 0===t.length)throw t.length+"/"+r;var e=function(){for(var e=0;e<t.length&&0==t[e];)e+=1;for(var n=new Array(t.length-e+r),o=0;o<t.length-e;o+=1)n[o]=t[o+e];return n}(),n={getAt:function(t){return e[t]},getLength:function(){return e.length},multiply:function(t){for(var r=new Array(n.getLength()+t.getLength()-1),e=0;e<n.getLength();e+=1)for(var o=0;o<t.getLength();o+=1)r[e+o]^=C.gexp(C.glog(n.getAt(e))+C.glog(t.getAt(o)));return k(r,0)},mod:function(t){if(n.getLength()-t.getLength()<0)return n;for(var r=C.glog(n.getAt(0))-C.glog(t.getAt(0)),e=new Array(n.getLength()),o=0;o<n.getLength();o+=1)e[o]=n.getAt(o);for(o=0;o<t.getLength();o+=1)e[o]^=C.gexp(C.glog(t.getAt(o))+r);return k(e,0).mod(t)}};return n}var A=function(){var t=[[1,26,19],[1,26,16],[1,26,13],[1,26,9],[1,44,34],[1,44,28],[1,44,22],[1,44,16],[1,70,55],[1,70,44],[2,35,17],[2,35,13],[1,100,80],[2,50,32],[2,50,24],[4,25,9],[1,134,108],[2,67,43],[2,33,15,2,34,16],[2,33,11,2,34,12],[2,86,68],[4,43,27],[4,43,19],[4,43,15],[2,98,78],[4,49,31],[2,32,14,4,33,15],[4,39,13,1,40,14],[2,121,97],[2,60,38,2,61,39],[4,40,18,2,41,19],[4,40,14,2,41,15],[2,146,116],[3,58,36,2,59,37],[4,36,16,4,37,17],[4,36,12,4,37,13],[2,86,68,2,87,69],[4,69,43,1,70,44],[6,43,19,2,44,20],[6,43,15,2,44,16],[4,101,81],[1,80,50,4,81,51],[4,50,22,4,51,23],[3,36,12,8,37,13],[2,116,92,2,117,93],[6,58,36,2,59,37],[4,46,20,6,47,21],[7,42,14,4,43,15],[4,133,107],[8,59,37,1,60,38],[8,44,20,4,45,21],[12,33,11,4,34,12],[3,145,115,1,146,116],[4,64,40,5,65,41],[11,36,16,5,37,17],[11,36,12,5,37,13],[5,109,87,1,110,88],[5,65,41,5,66,42],[5,54,24,7,55,25],[11,36,12,7,37,13],[5,122,98,1,123,99],[7,73,45,3,74,46],[15,43,19,2,44,20],[3,45,15,13,46,16],[1,135,107,5,136,108],[10,74,46,1,75,47],[1,50,22,15,51,23],[2,42,14,17,43,15],[5,150,120,1,151,121],[9,69,43,4,70,44],[17,50,22,1,51,23],[2,42,14,19,43,15],[3,141,113,4,142,114],[3,70,44,11,71,45],[17,47,21,4,48,22],[9,39,13,16,40,14],[3,135,107,5,136,108],[3,67,41,13,68,42],[15,54,24,5,55,25],[15,43,15,10,44,16],[4,144,116,4,145,117],[17,68,42],[17,50,22,6,51,23],[19,46,16,6,47,17],[2,139,111,7,140,112],[17,74,46],[7,54,24,16,55,25],[34,37,13],[4,151,121,5,152,122],[4,75,47,14,76,48],[11,54,24,14,55,25],[16,45,15,14,46,16],[6,147,117,4,148,118],[6,73,45,14,74,46],[11,54,24,16,55,25],[30,46,16,2,47,17],[8,132,106,4,133,107],[8,75,47,13,76,48],[7,54,24,22,55,25],[22,45,15,13,46,16],[10,142,114,2,143,115],[19,74,46,4,75,47],[28,50,22,6,51,23],[33,46,16,4,47,17],[8,152,122,4,153,123],[22,73,45,3,74,46],[8,53,23,26,54,24],[12,45,15,28,46,16],[3,147,117,10,148,118],[3,73,45,23,74,46],[4,54,24,31,55,25],[11,45,15,31,46,16],[7,146,116,7,147,117],[21,73,45,7,74,46],[1,53,23,37,54,24],[19,45,15,26,46,16],[5,145,115,10,146,116],[19,75,47,10,76,48],[15,54,24,25,55,25],[23,45,15,25,46,16],[13,145,115,3,146,116],[2,74,46,29,75,47],[42,54,24,1,55,25],[23,45,15,28,46,16],[17,145,115],[10,74,46,23,75,47],[10,54,24,35,55,25],[19,45,15,35,46,16],[17,145,115,1,146,116],[14,74,46,21,75,47],[29,54,24,19,55,25],[11,45,15,46,46,16],[13,145,115,6,146,116],[14,74,46,23,75,47],[44,54,24,7,55,25],[59,46,16,1,47,17],[12,151,121,7,152,122],[12,75,47,26,76,48],[39,54,24,14,55,25],[22,45,15,41,46,16],[6,151,121,14,152,122],[6,75,47,34,76,48],[46,54,24,10,55,25],[2,45,15,64,46,16],[17,152,122,4,153,123],[29,74,46,14,75,47],[49,54,24,10,55,25],[24,45,15,46,46,16],[4,152,122,18,153,123],[13,74,46,32,75,47],[48,54,24,14,55,25],[42,45,15,32,46,16],[20,147,117,4,148,118],[40,75,47,7,76,48],[43,54,24,22,55,25],[10,45,15,67,46,16],[19,148,118,6,149,119],[18,75,47,31,76,48],[34,54,24,34,55,25],[20,45,15,61,46,16]],r=function(t,r){var e={};return e.totalCount=t,e.dataCount=r,e},e={};return e.getRSBlocks=function(e,n){var o=function(r,e){switch(e){case g.L:return t[4*(r-1)+0];case g.M:return t[4*(r-1)+1];case g.Q:return t[4*(r-1)+2];case g.H:return t[4*(r-1)+3];default:return}}(e,n);if(void 0===o)throw"bad rs block @ typeNumber:"+e+"/errorCorrectionLevel:"+n;for(var i=o.length/3,a=[],u=0;u<i;u+=1)for(var f=o[3*u+0],c=o[3*u+1],l=o[3*u+2],h=0;h<f;h+=1)a.push(r(c,l));return a},e}(),b=function(){var t=[],r=0,e={getBuffer:function(){return t},getAt:function(r){var e=Math.floor(r/8);return 1==(t[e]>>>7-r%8&1)},put:function(t,r){for(var n=0;n<r;n+=1)e.putBit(1==(t>>>r-n-1&1))},getLengthInBits:function(){return r},putBit:function(e){var n=Math.floor(r/8);t.length<=n&&t.push(0),e&&(t[n]|=128>>>r%8),r+=1}};return e},M=function(t){var r=a,e=t,n={getMode:function(){return r},getLength:function(t){return e.length},write:function(t){for(var r=e,n=0;n+2<r.length;)t.put(o(r.substring(n,n+3)),10),n+=3;n<r.length&&(r.length-n==1?t.put(o(r.substring(n,n+1)),4):r.length-n==2&&t.put(o(r.substring(n,n+2)),7))}},o=function(t){for(var r=0,e=0;e<t.length;e+=1)r=10*r+i(t.charAt(e));return r},i=function(t){if("0"<=t&&t<="9")return t.charCodeAt(0)-"0".charCodeAt(0);throw"illegal char :"+t};return n},x=function(t){var r=u,e=t,n={getMode:function(){return r},getLength:function(t){return e.length},write:function(t){for(var r=e,n=0;n+1<r.length;)t.put(45*o(r.charAt(n))+o(r.charAt(n+1)),11),n+=2;n<r.length&&t.put(o(r.charAt(n)),6)}},o=function(t){if("0"<=t&&t<="9")return t.charCodeAt(0)-"0".charCodeAt(0);if("A"<=t&&t<="Z")return t.charCodeAt(0)-"A".charCodeAt(0)+10;switch(t){case" ":return 36;case"$":return 37;case"%":return 38;case"*":return 39;case"+":return 40;case"-":return 41;case".":return 42;case"/":return 43;case":":return 44;default:throw"illegal char :"+t}};return n},m=function(r){var e=f,n=t.stringToBytes(r),o={getMode:function(){return e},getLength:function(t){return n.length},write:function(t){for(var r=0;r<n.length;r+=1)t.put(n[r],8)}};return o},L=function(r){var e=c,n=t.stringToBytesFuncs.SJIS;if(!n)throw"sjis not supported.";!function(){var t=n("友");if(2!=t.length||38726!=(t[0]<<8|t[1]))throw"sjis not supported."}();var o=n(r),i={getMode:function(){return e},getLength:function(t){return~~(o.length/2)},write:function(t){for(var r=o,e=0;e+1<r.length;){var n=(255&r[e])<<8|255&r[e+1];if(33088<=n&&n<=40956)n-=33088;else{if(!(57408<=n&&n<=60351))throw"illegal char at "+(e+1)+"/"+n;n-=49472}n=192*(n>>>8&255)+(255&n),t.put(n,13),e+=2}if(e<r.length)throw"illegal char at "+(e+1)}};return i},D=function(){var t=[],r={writeByte:function(r){t.push(255&r)},writeShort:function(t){r.writeByte(t),r.writeByte(t>>>8)},writeBytes:function(t,e,n){e=e||0,n=n||t.length;for(var o=0;o<n;o+=1)r.writeByte(t[o+e])},writeString:function(t){for(var e=0;e<t.length;e+=1)r.writeByte(t.charCodeAt(e))},toByteArray:function(){return t},toString:function(){var r="";r+="[";for(var e=0;e<t.length;e+=1)e>0&&(r+=","),r+=t[e];return r+="]"}};return r},S=function(t){var r=t,e=0,n=0,o=0,i={read:function(){for(;o<8;){if(e>=r.length){if(0==o)return-1;throw"unexpected end of file./"+o}var t=r.charAt(e);if(e+=1,"="==t)return o=0,-1;t.match(/^\s$/)||(n=n<<6|a(t.charCodeAt(0)),o+=6)}var i=n>>>o-8&255;return o-=8,i}},a=function(t){if(65<=t&&t<=90)return t-65;if(97<=t&&t<=122)return t-97+26;if(48<=t&&t<=57)return t-48+52;if(43==t)return 62;if(47==t)return 63;throw"c:"+t};return i},I=function(t,r,e){for(var n=function(t,r){var e=t,n=r,o=new Array(t*r),i={setPixel:function(t,r,n){o[r*e+t]=n},write:function(t){t.writeString("GIF87a"),t.writeShort(e),t.writeShort(n),t.writeByte(128),t.writeByte(0),t.writeByte(0),t.writeByte(0),t.writeByte(0),t.writeByte(0),t.writeByte(255),t.writeByte(255),t.writeByte(255),t.writeString(","),t.writeShort(0),t.writeShort(0),t.writeShort(e),t.writeShort(n),t.writeByte(0);var r=a(2);t.writeByte(2);for(var o=0;r.length-o>255;)t.writeByte(255),t.writeBytes(r,o,255),o+=255;t.writeByte(r.length-o),t.writeBytes(r,o,r.length-o),t.writeByte(0),t.writeString(";")}},a=function(t){for(var r=1<<t,e=1+(1<<t),n=t+1,i=u(),a=0;a<r;a+=1)i.add(String.fromCharCode(a));i.add(String.fromCharCode(r)),i.add(String.fromCharCode(e));var f,c,g,l=D(),h=(f=l,c=0,g=0,{write:function(t,r){if(t>>>r!=0)throw"length over";for(;c+r>=8;)f.writeByte(255&(t<<c|g)),r-=8-c,t>>>=8-c,g=0,c=0;g|=t<<c,c+=r},flush:function(){c>0&&f.writeByte(g)}});h.write(r,n);var s=0,v=String.fromCharCode(o[s]);for(s+=1;s<o.length;){var d=String.fromCharCode(o[s]);s+=1,i.contains(v+d)?v+=d:(h.write(i.indexOf(v),n),i.size()<4095&&(i.size()==1<<n&&(n+=1),i.add(v+d)),v=d)}return h.write(i.indexOf(v),n),h.write(e,n),h.flush(),l.toByteArray()},u=function(){var t={},r=0,e={add:function(n){if(e.contains(n))throw"dup key:"+n;t[n]=r,r+=1},size:function(){return r},indexOf:function(r){return t[r]},contains:function(r){return void 0!==t[r]}};return e};return i}(t,r),o=0;o<r;o+=1)for(var i=0;i<t;i+=1)n.setPixel(i,o,e(i,o));var a=D();n.write(a);for(var u=function(){var t=0,r=0,e=0,n="",o={},i=function(t){n+=String.fromCharCode(a(63&t))},a=function(t){if(t<0);else{if(t<26)return 65+t;if(t<52)return t-26+97;if(t<62)return t-52+48;if(62==t)return 43;if(63==t)return 47}throw"n:"+t};return o.writeByte=function(n){for(t=t<<8|255&n,r+=8,e+=1;r>=6;)i(t>>>r-6),r-=6},o.flush=function(){if(r>0&&(i(t<<6-r),t=0,r=0),e%3!=0)for(var o=3-e%3,a=0;a<o;a+=1)n+="="},o.toString=function(){return n},o}(),f=a.toByteArray(),c=0;c<f.length;c+=1)u.writeByte(f[c]);return u.flush(),"data:image/gif;base64,"+u};return t}();qrcode.stringToBytesFuncs["UTF-8"]=function(t){return function(t){for(var r=[],e=0;e<t.length;e++){var n=t.charCodeAt(e);n<128?r.push(n):n<2048?r.push(192|n>>6,128|63&n):n<55296||n>=57344?r.push(224|n>>12,128|n>>6&63,128|63&n):(e++,n=65536+((1023&n)<<10|1023&t.charCodeAt(e)),r.push(240|n>>18,128|n>>12&63,128|n>>6&63,128|63&n))}return r}(t)},function(t){"function"==typeof define&&define.amd?define([],t):"object"==typeof exports&&(module.exports=t())}((function(){return qrcode}));
            return module.exports;
        })();
        if (qrcode && qrcode.stringToBytesFuncs && qrcode.stringToBytesFuncs['UTF-8']) {
            qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
        }

        /* ================= 设置持久化 ================= */
        function loadSettings() {
            var d = safe(function () { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); }, null);
            if (!d || typeof d !== 'object') return;
            if (typeof d.account === 'string') st.account = d.account;
            if (typeof d.userId === 'string') st.userId = d.userId;
            if (typeof d.nickname === 'string') st.nickname = d.nickname;
            if (typeof d.yb === 'string' && /^\d+$/.test(d.yb)) st.yb = d.yb;
        }

        function saveSettings() {
            safe(function () {
                localStorage.setItem(STORAGE_KEY, JSON.stringify({
                    v: 1,
                    account: st.account,
                    userId: st.userId,
                    nickname: st.nickname,
                    yb: st.yb
                }));
            });
        }

        /* ================= 自动读取页面数据 ================= */
        function readAccount() {
            var keys = ['LastUserName', 'SGS_LASTLOGIN_ACCOUNT', 'SGS_LASTLOGIN_ACCOUNT1'];
            for (var i = 0; i < keys.length; i++) {
                var v = trim(safe(function () { return localStorage.getItem(keys[i]); }, ''));
                if (v) return v;
            }
            return '';
        }

        function readHud() {
            var out = { id: '', nickname: '' };
            function take(text) {
                var t = trim(text);
                if (!t || t.length > 60) return;
                var m;
                if (!out.id && (m = t.match(/(?:\b|玩家\s*)id\s*[：:]\s*(\d{6,12})/i))) out.id = m[1];
                if (!out.nickname && (m = t.match(/昵称\s*[：:]\s*(\S.*)$/))) out.nickname = trim(m[1]);
            }
            // 1.6.66 的固定 id（大写「ID：」），先认它们，iPad 上最稳
            try {
                var idEl = document.getElementById('GMHCcZ6JV');
                if (idEl) take(idEl.textContent);
                var nickEl = document.getElementById('h4uaXmO');
                if (nickEl) take(nickEl.textContent);
            } catch (e) {}
            // 叶子节点的文本（老版本结构）
            if (!out.id || !out.nickname) {
                try {
                    var nodes = document.querySelectorAll('div,span');
                    for (var i = 0; i < nodes.length; i++) {
                        var el = nodes[i];
                        if (el.children && el.children.length) continue;
                        take(el.textContent);
                        if (out.id && out.nickname) break;
                    }
                } catch (e) {}
            }
            // 文本节点兜底（iPad 上 HUD 可能被拆成多个节点）
            if (!out.id || !out.nickname) {
                try {
                    var host = document.body || document.documentElement;
                    if (host && document.createTreeWalker && typeof NodeFilter !== 'undefined') {
                        var walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT, null, false);
                        var node, guard = 0;
                        while ((node = walker.nextNode()) && guard++ < 8000) {
                            take(node.nodeValue);
                            if (out.id && out.nickname) break;
                        }
                    }
                } catch (e) {}
            }
            return out;
        }

        function readDeviceId() {
            return safe(function () {
                var c = window.SgsCensus;
                if (c && typeof c.GetDeviceID === 'function') return trim(c.GetDeviceID());
                return '';
            }, '');
        }

        function applyAuto(key, inputId, value) {
            if (!value) return;
            var el = $(inputId);
            if (!el) { if (!st[key]) st[key] = value; return; }
            if (el.value === '' || el.value === st.auto[key]) {
                if (el.value !== value) el.value = value;
                st[key] = value;
            }
            st.auto[key] = value;
        }

        function refreshAutoFields() {
            applyAuto('account', 'xc95Account', readAccount());
            var hud = readHud();
            applyAuto('userId', 'xc95UserId', hud.id);
            applyAuto('nickname', 'xc95Nick', hud.nickname);
        }

        function readFormIntoState() {
            var map = { xc95Account: 'account', xc95UserId: 'userId', xc95Nick: 'nickname', xc95Yb: 'yb' };
            Object.keys(map).forEach(function (id) {
                var el = $(id);
                if (el) st[map[id]] = trim(el.value);
            });
        }

        /* ================= 接口调用 ================= */
        function makeSign(payload) {
            var raw = Object.keys(payload)
                .filter(function (k) { return k !== 'sign'; })
                .sort()
                .map(function (k) { return k + '=' + payload[k]; })
                .join('') + PAY_SECRET;
            return md5Hex(raw);
        }

        function buildPayload(yb) {
            var p = {
                account: st.account,
                yb: yb,
                server_id: FIXED.server_id,
                channel: FIXED.channel,
                nickname: st.nickname || '',
                user_id: st.userId
            };
            var udid = readDeviceId();
            if (udid) p.udid = udid;
            p.device_model = FIXED.device_model;
            p.osType = FIXED.osType;
            p.user_level = USER_LEVEL_FIXED;
            p.timestamp = Math.floor(Date.now() / 1000);
            p.sign = makeSign(p);
            return p;
        }

        function postJson(url, body, timeoutMs) {
            return new Promise(function (resolve, reject) {
                var done = false, controller = null;
                var timer = setTimeout(function () {
                    if (done) return;
                    done = true;
                    if (controller) { try { controller.abort(); } catch (e) {} }
                    reject(new Error('请求超时（' + Math.round(timeoutMs / 1000) + ' 秒）'));
                }, timeoutMs);
                var init = {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                };
                if (typeof AbortController === 'function') {
                    controller = new AbortController();
                    init.signal = controller.signal;
                }
                fetch(url, init).then(function (res) {
                    return res.text().then(function (text) {
                        if (done) return;
                        done = true;
                        clearTimeout(timer);
                        if (!res.ok) { reject(new Error('HTTP ' + res.status)); return; }
                        var data = null;
                        try { data = JSON.parse(text); } catch (e) { data = null; }
                        if (!data) { reject(new Error('返回内容不是 JSON：' + text.slice(0, 120))); return; }
                        resolve(data);
                    });
                }).catch(function (err) {
                    if (done) return;
                    done = true;
                    clearTimeout(timer);
                    reject(err);
                });
            });
        }

        function requestQr(kind, yb) {
            return postJson(PAY_BASE + kind + '/qrcode/order/create', buildPayload(yb), REQ_TIMEOUT_MS);
        }

        /* ================= 界面 ================= */
        function setStatus(text, isErr) {
            var el = $(STATUS_ID);
            if (!el) return;
            el.textContent = String(text == null ? '' : text);
            el.className = 'xc95Status' + (isErr ? ' err' : '');
        }

        function setButtonsDisabled(disabled) {
            ['xc95PayWechat', 'xc95PayAlipay'].forEach(function (id) {
                var b = $(id);
                if (b) b.disabled = !!disabled;
            });
        }

        function ensureStyle() {
            if (!document.head) return;
            if ($(STYLE_ID)) return;
            var css = [
                '#' + PANEL_ID + '{box-sizing:border-box;width:100%;margin:2px 0 4px;padding:6px 6px 8px;border-top:1px solid rgba(242,222,156,.18);color:#f2de9c}',
                '#' + PANEL_ID + '[hidden]{display:none!important}',
                // .xc95Row / .xc95Btns 的 display 会盖掉 hidden 属性的 UA 样式，这里统一强制隐藏
                '#' + PANEL_ID + ' [hidden]{display:none!important}',
                '#' + PANEL_ID + ' .xc95Row{display:block;width:100%;box-sizing:border-box;margin:0 0 5px}',
                '#' + PANEL_ID + ' .xc95Lbl{display:block;font-size:11px;line-height:16px;color:rgba(169,149,114,.95);margin:0 0 2px}',
                '#' + PANEL_ID + ' input.xc95Input{display:block;width:100%;box-sizing:border-box;height:24px;padding:0 8px;border:1px solid rgba(242,222,156,.28);border-radius:5px;background:linear-gradient(180deg,#221e1a 0%,#1a1613 100%);color:#f2de9c;font-size:12px;outline:none;margin:0}',
                '#' + PANEL_ID + ' input.xc95Input:focus{border-color:rgba(242,222,156,.65)}',
                '#' + PANEL_ID + ' input.xc95Input::placeholder{color:rgba(169,149,114,.55)}',
                '#' + PANEL_ID + ' .xc95Warn{font-size:11px;line-height:1.55;color:#ffb066}',
                '#' + PANEL_ID + ' .xc95Presets{display:flex;flex-wrap:wrap;gap:3px}',
                '#' + PANEL_ID + ' .xc95Chip{padding:1px 6px;border:1px solid rgba(242,222,156,.28);border-radius:5px;background:rgba(52,47,40,.9);color:#f2de9c;font-size:11.5px;line-height:18px;cursor:pointer;user-select:none}',
                '#' + PANEL_ID + ' .xc95Chip.on{background:linear-gradient(180deg,#d4b56a,#b8923f);color:#2a2010;border-color:rgba(242,222,156,.55)}',
                '#' + PANEL_ID + ' .xc95Btns{display:flex;gap:4px;width:100%}',
                '#' + PANEL_ID + ' .xc95Btns.xc95Btns2{flex-wrap:wrap}',
                '#' + PANEL_ID + ' .xc95Btns.xc95Btns2>.xc95Btn{flex:0 0 calc(50% - 2px);min-width:0}',
                '#' + PANEL_ID + ' .xc95Btn{flex:1 1 0;min-width:0;height:26px;padding:0 6px;border:1px solid rgba(242,222,156,.35);border-radius:6px;background:linear-gradient(180deg,#2c2721,#221e1a);color:#f2de9c;font-size:12px;line-height:24px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
                '#' + PANEL_ID + ' .xc95Btn:hover:not(:disabled){border-color:rgba(242,222,156,.65)}',
                '#' + PANEL_ID + ' .xc95Btn:disabled{opacity:.55;cursor:default}',
                '#' + PANEL_ID + ' .xc95Btn.wx{background:linear-gradient(180deg,#2f7d4f,#1f5c39);color:#eaffe9;border-color:rgba(160,230,190,.45)}',
                '#' + PANEL_ID + ' .xc95Btn.ali{background:linear-gradient(180deg,#2b6ea8,#1d4c74);color:#e8f4ff;border-color:rgba(150,200,240,.45)}',
                '#' + PANEL_ID + ' .xc95Status{font-size:11px;line-height:1.5;color:rgba(169,149,114,.95);word-break:break-all}',
                '#' + PANEL_ID + ' .xc95Status.err{color:#ff9a9a}',
                '#' + PANEL_ID + ' .xc95QrCard{box-sizing:border-box;width:100%;max-width:300px;margin:0 auto;background:#fff;border-radius:6px;padding:8px}',
                // 移动端 HUD 很窄：二维码卡片按手机宽度收小，避免一个巨大的二维码铺满面板
                '#' + PANEL_ID + '.xc95Mobile .xc95QrCard{max-width:min(190px,66vw);padding:6px}',
                '#' + PANEL_ID + '.xc95Mobile .xc95QrImg img,#' + PANEL_ID + '.xc95Mobile .xc95QrImg canvas{image-rendering:auto}',
                '#' + PANEL_ID + ' .xc95QrImg{display:block;width:100%;max-width:100%;background:#fff}',
                '#' + PANEL_ID + ' .xc95QrImg img,#' + PANEL_ID + ' .xc95QrImg canvas{display:block;width:100%;height:auto;max-width:100%;background:#fff;image-rendering:pixelated;image-rendering:crisp-edges}',
                '#' + PANEL_ID + ' .xc95CashierWrap{position:relative;overflow:hidden;background:#fff;margin:0 auto;border-radius:4px}',
                '#' + PANEL_ID + ' .xc95CashierWrap iframe.xc95Cashier{position:absolute;left:0;top:0;border:0;background:#fff}',
                '#' + PANEL_ID + ' .xc95QrTip{margin-top:4px;font-size:11px;line-height:1.4;color:#7a6c50}',
                '#' + PANEL_ID + ' .xc95Meta{margin-top:5px;font-size:11px;line-height:1.6;color:rgba(169,149,114,.95);word-break:break-all}',
                '#' + PANEL_ID + ' .xc95Meta b{color:#f2de9c;font-weight:600}',
                '#' + ZOOM_ID + '{position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:12px;box-sizing:border-box;background:rgba(0,0,0,.72)}',
                '#' + ZOOM_ID + ' .xc95ZoomCard{background:#fff;border-radius:10px;padding:12px;box-sizing:border-box;max-width:min(92vw,480px);box-shadow:0 8px 30px rgba(0,0,0,.5)}',
                '#' + ZOOM_ID + ' .xc95QrImg{display:block;width:100%;max-width:420px;margin:0 auto;background:#fff}',
                '#' + ZOOM_ID + ' .xc95QrImg img,#' + ZOOM_ID + ' .xc95QrImg canvas{display:block;width:100%;height:auto;max-width:100%;background:#fff;image-rendering:pixelated;image-rendering:crisp-edges}',
                '#' + ZOOM_ID + ' .xc95CashierWrap{position:relative;overflow:hidden;background:#fff;margin:0 auto;border-radius:4px}',
                '#' + ZOOM_ID + ' .xc95CashierWrap iframe.xc95Cashier{position:absolute;left:0;top:0;border:0;background:#fff}',
                '#' + ZOOM_ID + ' .xc95ZoomNote{margin-top:8px;font:12px/1.65 system-ui,-apple-system,"Microsoft YaHei",sans-serif;color:#333;word-break:break-all}',
                '#' + ZOOM_ID + ' .xc95ZoomNote b{color:#111}',
                '#' + ZOOM_ID + ' .xc95ZoomBar{display:flex;gap:6px;margin-top:8px}',
                '#' + ZOOM_ID + ' .xc95ZoomBar button{flex:1 1 0;height:28px;border:1px solid #bbb;border-radius:6px;background:#f4f4f4;color:#222;font-size:12px;cursor:pointer}',
                '#' + ZOOM_ID + ' .xc95ZoomBar button:hover{background:#e9e9e9}'
            ].join('\n');
            var style = document.createElement('style');
            style.id = STYLE_ID;
            style.textContent = css;
            (document.head || document.documentElement).appendChild(style);
        }

        // opts: { minModule, maxModule, allowScaleDown }
        // 面板窄到放不下 minModule 时，仍然按 minModule 画（宁可等比缩小也别画成 1px/模块的糊码）
        function drawQr(text, availPx, opts) {
            opts = opts || {};
            var minModule = opts.minModule || QR_MIN_MODULE_PX;
            var maxModule = opts.maxModule || QR_MAX_MODULE_PX;
            var allowScaleDown = opts.allowScaleDown !== false;
            var qr;
            try {
                qr = qrcode(0, QR_ECC);
                qr.addData(text);
                qr.make();
            } catch (e) {
                console.warn(TAG, '二维码编码失败:', e);
                return null;
            }
            var n = qr.getModuleCount();
            var total = n + QR_QUIET * 2;
            var avail = Math.max(60, Math.floor(availPx || 240));
            var moduleSize = Math.floor(avail / total);
            var scaledDown = false;
            if (moduleSize > maxModule) moduleSize = maxModule;
            if (moduleSize < minModule) {
                if (!allowScaleDown) return null;
                moduleSize = minModule;
                scaledDown = true;
            }
            var size = total * moduleSize;
            if (size > avail) scaledDown = true;

            var canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            var ctx = canvas.getContext('2d');
            if (!ctx) return null;
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, size, size);
            ctx.fillStyle = '#000000';
            for (var r = 0; r < n; r++) {
                for (var c = 0; c < n; c++) {
                    if (qr.isDark(r, c)) {
                        ctx.fillRect((c + QR_QUIET) * moduleSize, (r + QR_QUIET) * moduleSize, moduleSize, moduleSize);
                    }
                }
            }
            return { canvas: canvas, modules: n, total: total, moduleSize: moduleSize, size: size, scaledDown: scaledDown };
        }

        // 支付宝：把收银台页面按 k 倍整体缩放后塞进白底容器，露出左上角那张最终付款码。
        // 这样用户扫的是 qr.alipay.com 的付款码本身，不需要再跳一次。
        function renderCashierInto(host, url, targetPx) {
            var avail = Math.max(120, Math.floor(targetPx || 230));
            var pad = CASHIER_QR_PAD;
            // 缩放倍数：让「码 + 两侧留白」正好放进可用宽度
            var k = Math.min(3, Math.max(0.5, (avail - pad * 2) / CASHIER_QR_BASE));
            var qrOnScreen = Math.round(CASHIER_QR_BASE * k);
            var boxSize = qrOnScreen + pad * 2;

            var wrap = document.createElement('div');
            wrap.className = 'xc95CashierWrap';
            wrap.style.width = boxSize + 'px';
            wrap.style.height = boxSize + 'px';

            var frame = document.createElement('iframe');
            frame.className = 'xc95Cashier';
            frame.setAttribute('sandbox', CASHIER_SANDBOX);
            frame.setAttribute('scrolling', 'no');
            frame.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
            frame.style.width = Math.ceil((boxSize + 80) / k) + 'px';
            frame.style.height = Math.ceil((boxSize + 260) / k) + 'px';
            frame.style.transform = 'scale(' + k + ')';
            frame.style.transformOrigin = '0 0';
            // 收银台里码并不在页面原点，这里把整页平移，使码在容器内居中
            frame.style.left = (pad - CASHIER_QR_X * k) + 'px';
            frame.style.top = (pad - CASHIER_QR_Y * k) + 'px';
            frame.src = url;
            wrap.appendChild(frame);
            host.appendChild(wrap);
            host.setAttribute('data-cashier-k', k.toFixed(2));

            // 内嵌失败（被拦 / 加载不出来）时给个提示，让用户切备用二维码
            var settled = false;
            frame.addEventListener('load', function () { settled = true; });
            setTimeout(function () {
                if (settled || !host.isConnected) return;
                var tip = $(TIP_ID);
                if (tip && st.last && st.last.view !== 'backup') {
                    tip.textContent = '收银台加载较慢或被拦截；可点「备用二维码」，或点「新标签页打开」。';
                }
            }, 9000);
            return true;
        }

        // 把二维码画进一个白底容器；返回是否成功
        // opts: { width, maxModule, zoom }
        function renderQrInto(host, last, opts) {
            if (!host || !last) return false;
            opts = opts || {};
            host.innerHTML = '';
            host.removeAttribute('data-total-modules');
            host.removeAttribute('data-scaled-down');
            host.removeAttribute('data-cashier-k');
            if (last.kind === 'wechat') {
                // 服务端如果直接回 weixin:// 字符串，本地生成二维码；否则显示服务端图片
                if (/^weixin:\/\//i.test(last.img)) {
                    var r = drawQr(last.img, opts.width, {
                        minModule: QR_MIN_MODULE_PX,
                        maxModule: opts.maxModule || QR_MAX_MODULE_PX,
                        allowScaleDown: true
                    });
                    if (r) {
                        host.appendChild(r.canvas);
                        host.setAttribute('data-total-modules', String(r.total));
                        host.setAttribute('data-scaled-down', r.scaledDown ? '1' : '0');
                        return true;
                    }
                }
                var img = document.createElement('img');
                img.alt = '微信支付二维码';
                img.onerror = function () {
                    host.innerHTML = '';
                    var d = document.createElement('div');
                    d.style.cssText = 'background:#fff;color:#111;border-radius:6px;padding:8px;font:11px/1.6 system-ui,sans-serif';
                    d.textContent = '二维码图片加载失败，请重新出码或改用支付宝。';
                    host.appendChild(d);
                };
                img.src = last.img;
                host.appendChild(img);
                return true;
            }
            // 支付宝：默认直出收银台的最终付款码（带支付宝 logo 的那张干净二维码）。
            // 移动端也用它，只是外面用 card 的小尺寸容器裁到二维码本身；
            // 只有「备用二维码」才本地生成长链接二维码。
            if (last.kind === 'alipay' && last.view !== 'backup') {
                return renderCashierInto(host, last.url, opts.width);
            }
            var qrText = last.kind === 'alipay' ? (last.alipayFinal || last.url) : last.url;
            var r = drawQr(qrText, opts.width, {
                minModule: QR_MIN_MODULE_PX,
                maxModule: opts.maxModule || QR_MAX_MODULE_PX,
                allowScaleDown: true
            });
            if (!r) return false;
            host.appendChild(r.canvas);
            host.setAttribute('data-total-modules', String(r.total));
            host.setAttribute('data-scaled-down', r.scaledDown ? '1' : '0');
            return true;
        }

        function panelQrWidth() {
            var card = $(QR_CARD_ID);
            var w = card ? card.clientWidth : 0;
            if (!w) w = 232;
            return w - 16;   // 白卡左右各 8px 内边距
        }

        function metaHtml(last) {
            function esc(s) {
                return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
                    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
                });
            }
            return '<div><b>支付方式：</b>' + (last.kind === 'wechat' ? '微信' : '支付宝') + '</div>' +
                '<div><b>元宝：</b>' + esc(last.yb) + '</div>' +
                '<div><b>账号：</b>' + esc(last.account) + '</div>' +
                '<div><b>玩家ID：</b>' + esc(last.userId) + '</div>' +
                (last.orderId ? '<div><b>订单号：</b>' + esc(last.orderId) + '</div>' : '');
        }

        function makeFallbackNode(last) {
            var box = document.createElement('div');
            box.style.cssText = 'background:#fff;color:#111;border-radius:6px;padding:8px;font:11px/1.5 Consolas,monospace;word-break:break-all;max-height:160px;overflow:auto';
            box.textContent = last.kind === 'wechat' ? '（二维码图片不可用）' : last.url;
            return box;
        }

        function renderResult() {
            var wrap = $(RESULT_ID), box = $(QRBOX_ID), tip = $(TIP_ID), meta = $(META_ID);
            var copyBtn = $(COPY_ID), openBtn = $(OPEN_ID);
            if (!wrap || !box || !tip || !meta || !st.last) return;
            var last = st.last;
            wrap.hidden = false;
            wrap.style.display = 'block';
            tip.textContent = '';
            box.innerHTML = '';

            var ok = renderQrInto(box, last, { width: panelQrWidth() });
            if (!ok) {
                box.appendChild(makeFallbackNode(last));
                tip.textContent = '面板里放不下清晰二维码，请点「放大二维码」重试，或复制支付链接。';
            } else if (last.kind === 'alipay' && last.view !== 'backup') {
                tip.textContent = '这是支付宝的最终付款码，直接扫这一个就行（30 分钟内有效）。扫不动可点「放大二维码」。';
            } else {
                // 用真实渲染宽度算每个码点占多少像素，太小就提示去放大
                var totalModules = Number(box.getAttribute('data-total-modules')) || 0;
                var canvas = box.querySelector('canvas');
                var pxPerModule = 0;
                if (canvas && totalModules) {
                    var cssW = canvas.getBoundingClientRect().width || canvas.clientWidth || 0;
                    if (cssW) pxPerModule = cssW / totalModules;
                }
                if (box.getAttribute('data-scaled-down') === '1' || (pxPerModule && pxPerModule < 2.5)) {
                    tip.textContent = '面板里码点偏小（约 ' + (pxPerModule ? pxPerModule.toFixed(1) : '?') +
                        'px/码点），建议点「放大二维码」后再扫描。';
                }
            }

            meta.innerHTML = metaHtml(last);
            if (last.kind === 'alipay') resolveAlipayFinal(last);
            if (copyBtn) copyBtn.hidden = last.kind !== 'alipay';
            if (openBtn) openBtn.hidden = last.kind !== 'alipay' || xcIsTouchDevice();
            var backupBtn = $(BACKUP_ID);
            if (backupBtn) {
                backupBtn.hidden = last.kind !== 'alipay';
                backupBtn.textContent = last.view === 'backup' ? '收起备用码' : '备用二维码';
            }
            var zoomBtn = $(ZOOM_BTN_ID);
            if (zoomBtn) zoomBtn.hidden = false;
            var isMobileAlipay = xcIsTouchDevice() && last.kind === 'alipay';
            // 移动端选支付宝时隐去说明文字，换成直接的「打开支付宝付款」按钮
            if (isMobileAlipay) {
                tip.textContent = '';
                tip.hidden = true;
            } else {
                tip.hidden = false;
            }
            var jump = $('xc95Jump');
            if (jump) {
                jump.hidden = !isMobileAlipay;
                // 内联 display 兜底：.xc95Btns 的 display:flex 会盖掉 hidden 属性
                jump.style.display = isMobileAlipay ? 'flex' : 'none';
            }
        }

        function copyText(text) {
            var done = function () { setStatus('支付链接已复制到剪贴板', false); };
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(done, function () { legacyCopy(text); done(); });
                return;
            }
            legacyCopy(text);
            done();
        }

        function legacyCopy(text) {
            safe(function () {
                var ta = document.createElement('textarea');
                ta.value = text;
                ta.style.cssText = 'position:fixed;left:-9999px;top:0';
                document.body.appendChild(ta);
                ta.select();
                try { document.execCommand('copy'); } catch (e) {}
                ta.remove();
            });
        }

        /* ================= 放大二维码（fixed 定位，不受面板 overflow 限制） ================= */
        function closeZoom() {
            var el = $(ZOOM_ID);
            if (el && el.parentNode) el.parentNode.removeChild(el);
            document.removeEventListener('keydown', onZoomKey, true);
        }

        function onZoomKey(ev) {
            if (ev && (ev.key === 'Escape' || ev.keyCode === 27)) closeZoom();
        }

        function openZoom() {
            var last = st.last;
            if (!last) return;
            closeZoom();
            var overlay = document.createElement('div');
            overlay.id = ZOOM_ID;
            var card = document.createElement('div');
            card.className = 'xc95ZoomCard';
            var host = document.createElement('div');
            host.className = 'xc95QrImg';
            var note = document.createElement('div');
            note.className = 'xc95ZoomNote';
            note.innerHTML = metaHtml(last);
            var bar = document.createElement('div');
            bar.className = 'xc95ZoomBar';
            var btnClose = document.createElement('button');
            btnClose.type = 'button';
            btnClose.textContent = '关闭（Esc）';
            btnClose.addEventListener('click', function (ev) {
                ev.preventDefault(); ev.stopPropagation(); closeZoom();
            });
            bar.appendChild(btnClose);
            if (last.kind === 'alipay') {
                var btnCopy = document.createElement('button');
                btnCopy.type = 'button';
                btnCopy.textContent = '复制支付链接';
                btnCopy.addEventListener('click', function (ev) {
                    ev.preventDefault(); ev.stopPropagation(); copyText(last.url);
                });
                bar.appendChild(btnCopy);
            }
            card.appendChild(host);
            card.appendChild(note);
            card.appendChild(bar);
            overlay.appendChild(card);
            overlay.addEventListener('click', function (ev) {
                if (ev.target === overlay) closeZoom();
            });
            (document.body || document.documentElement).appendChild(overlay);

            var availW = Math.min(window.innerWidth * 0.9, 520) - 40;
            var availH = Math.max(200, window.innerHeight * 0.82 - 150);
            var avail = Math.max(160, Math.min(420, availW, availH));
            var ok = renderQrInto(host, last, { width: avail, maxModule: 8, zoom: true });
            if (!ok) {
                host.appendChild(makeFallbackNode(last));
                host.style.background = 'transparent';
            }
            document.addEventListener('keydown', onZoomKey, true);
        }

        /* ================= 表单 / 流程 ================= */
        function validate() {
            if (!st.account) return '请先填写账号（登录游戏时用的用户名）';
            if (!/^\d{6,12}$/.test(st.userId)) return '请填写正确的玩家ID（游戏内「设置」里复制的那串数字）';
            if (!/^\d+$/.test(st.yb) || Number(st.yb) <= 0) return '请填写有效的元宝数量';
            return '';
        }

        function onPay(kind) {
            if (st.busy) return;
            readFormIntoState();
            saveSettings();
            var err = validate();
            if (err) { setStatus(err, true); return; }
            var yb = parseInt(st.yb, 10);
            var label = kind === 'wechat' ? '微信' : '支付宝';
            st.busy = true;
            setButtonsDisabled(true);
            setStatus('正在请求' + label + '二维码…', false);
            var res = $(RESULT_ID);
            if (res) { res.hidden = true; res.style.display = 'none'; }
            requestQr(kind, yb).then(function (data) {
                if (!data || data.code !== 0) {
                    throw new Error((data && (data.msg || data.message)) || '接口返回异常');
                }
                var d = data.data || {};
                var codeUrl = d.code_url || '';
                if (!codeUrl) throw new Error('接口没有返回 code_url');
                st.last = {
                    kind: kind,
                    orderId: String(d.order_id || ''),
                    img: kind === 'wechat' ? codeUrl : '',
                    url: kind === 'wechat' ? '' : codeUrl,
                    view: 'final',
                    yb: yb,
                    account: st.account,
                    userId: st.userId,
                    nickname: st.nickname,
                    ts: Date.now()
                };
                if (kind === 'alipay') resolveAlipayFinal(st.last);
                renderResult();
                setStatus(label + '二维码已生成：请核对下面的账号 / 玩家ID / 元宝数后再支付（30 分钟内有效）', false);
                console.log(TAG, '出码成功', { kind: kind, yb: yb, order_id: st.last.orderId });
                if (xcPendingPayApp === kind) {
                    xcPendingPayApp = '';
                    // 出码是异步的，自动跳转会丢掉用户手势；提示用户再点一次
                    setStatus(label + '二维码已生成，请再点一次「打开' + label + '」跳转', false);
                }
            }).catch(function (e) {
                if (xcPendingPayApp === kind) xcPendingPayApp = '';
                var msg = String((e && e.message) || e || '未知错误');
                setStatus('出码失败：' + msg, true);
                console.warn(TAG, '出码失败:', e);
            }).then(function () {
                st.busy = false;
                setButtonsDisabled(false);
            });
        }

        // 移动端：二维码下面只给「打开支付宝付款」。
        // 微信实测只接受摄像头扫码（相册/截图不识别），所以不提供微信自动跳转，只保留二维码。
        var xcPendingPayApp = '';

        // 支付宝的 code_url 有时是外层收银台链接，真正能直接唤起付款页的是里面
        // qr.alipay.com/… 那一条。这里尽量把最终链接抠出来；抠不到就原样用。
        function extractAlipayFinal(url) {
            var s = String(url || '');
            var re = /(https?:\/\/qr\.alipay\.com\/[^\s"'<>\\]+)/i;
            var m = s.match(re);
            if (!m) {
                try {
                    var decoded = decodeURIComponent(s);
                    if (decoded !== s) m = decoded.match(re);
                } catch (e) {}
            }
            return m ? m[1] : s;
        }

        function resolveAlipayFinal(last) {
            if (!last || last.kind !== 'alipay' || !last.url) return;
            var direct = extractAlipayFinal(last.url);
            last.alipayFinal = direct;
            if (/qr\.alipay\.com/i.test(direct) || last.alipayFinalFetching) return;
            // 外层链接时尝试 fetch 收银台页面，从 HTML 里找最终 qr.alipay.com 链接
            var f = NATIVE.fetch || window.fetch;
            if (typeof f !== 'function') return;
            last.alipayFinalFetching = true;
            try {
                f.call(window, last.url, {
                    method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store'
                }).then(function (r) {
                    return r.ok ? r.text() : '';
                }).then(function (text) {
                    var m = String(text || '').match(/(https?:\/\/qr\.alipay\.com\/[^\s"'<>\\]+)/i);
                    if (m) {
                        last.alipayFinal = m[1];
                        if (st.last === last) {
                            try { renderResult(); } catch (e) {}
                        }
                    }
                }).catch(function () {}).then(function () {
                    last.alipayFinalFetching = false;
                });
            } catch (e) {
                last.alipayFinalFetching = false;
            }
        }

        function openPayApp(kind) {
            if (!xcIsTouchDevice()) return;
            if (kind !== 'alipay') return;   // 只保留支付宝跳转；微信不提供自动跳转
            // 当前二维码不是支付宝：先出支付宝码，成功后提示再点一次
            if (!st.last || st.last.kind !== 'alipay') {
                if (st.busy) return;
                xcPendingPayApp = kind;
                onPay(kind);
                return;
            }
            var target = st.last.alipayFinal || extractAlipayFinal(st.last.url) || '';
            var original = st.last.url || '';
            var tries = [];
            if (target) {
                // 先试扫码结果深链（拿到的若是收银台里的最终 qr.alipay.com 链接，有机会直接进付款页）；
                // 不行再试 appId/url（会经过支付宝收银台 H5 再唤起原生支付）。
                tries.push('alipays://platformapi/startapp?saId=10000007&qrcode=' + encodeURIComponent(target));
                tries.push('alipays://platformapi/startapp?appId=20000067&url=' + encodeURIComponent(target));
            }
            if (original && original !== target) {
                tries.push('alipays://platformapi/startapp?saId=10000007&qrcode=' + encodeURIComponent(original));
            }
            tries.push('alipays://');
            // 每次点击只尝试一种，保证自定义 scheme 始终发生在用户手势里；
            // 只打开 App 没进付款页时，再点一次会换下一种深链。
            var i = (Number(st.last.alipayTry) || 0) % tries.length;
            st.last.alipayTry = i + 1;
            setStatus(i === 0 ? '正在打开支付宝付款页…（若只打开 App，请再点一次「打开支付宝」）' :
                '正在尝试另一种支付宝打开方式（' + (i + 1) + '/' + tries.length + '）…', false);
            try { location.href = tries[i]; } catch (e) {}
        }

        // 支付宝：在「收银台直出最终付款码」和「本地生成的长链接二维码」之间切换
        function toggleBackup() {
            if (!st.last || st.last.kind !== 'alipay') return;
            st.last.view = st.last.view === 'backup' ? 'final' : 'backup';
            renderResult();
            setStatus(st.last.view === 'backup'
                ? '已切换到备用二维码（长链接，支付宝里可能还要再点一下）'
                : '已切回收银台最终付款码（扫一次即可）', false);
        }

        function buildPanel() {
            var panel = document.createElement('div');
            panel.id = PANEL_ID;
            panel.className = xcIsTouchDevice() ? 'xc95Mobile' : '';
            panel.hidden = true;
            panel.innerHTML = [
                '<div class="xc95Row xc95Warn">请先核对账号与玩家ID再付款；建议先充小额确认到账，再充大额。</div>',
                '<div class="xc95Row"><label class="xc95Lbl">账号（登录游戏时的用户名）</label>',
                '<input id="xc95Account" class="xc95Input" type="text" autocomplete="off" spellcheck="false"></div>',
                '<div class="xc95Row"><label class="xc95Lbl">玩家ID（10 位，游戏设置里复制）</label>',
                '<input id="xc95UserId" class="xc95Input" type="text" inputmode="numeric" maxlength="12" autocomplete="off" spellcheck="false"></div>',
                '<div class="xc95Row"><label class="xc95Lbl">昵称</label>',
                '<input id="xc95Nick" class="xc95Input" type="text" autocomplete="off" spellcheck="false"></div>',
                '<div class="xc95Row"><label class="xc95Lbl">元宝数量</label>',
                '<div class="xc95Presets" id="xc95Presets"></div></div>',
                '<div class="xc95Row"><input id="xc95Yb" class="xc95Input" type="text" inputmode="numeric" maxlength="7" placeholder="自定义元宝数"></div>',
                '<div class="xc95Row xc95Btns">',
                '<button type="button" class="xc95Btn wx" id="xc95PayWechat">微信支付</button>',
                '<button type="button" class="xc95Btn ali" id="xc95PayAlipay">支付宝支付</button>',
                '</div>',
                '<div class="xc95Row"><div class="xc95Status" id="' + STATUS_ID + '">填好账号与玩家ID后点上面任意一个支付方式出码</div></div>',
                '<div class="xc95Row" id="' + RESULT_ID + '" hidden style="display:none">',
                '<div class="xc95QrCard" id="' + QR_CARD_ID + '">',
                '<div class="xc95QrImg" id="' + QRBOX_ID + '"></div>',
                '<div class="xc95QrTip" id="' + TIP_ID + '"></div>',
                '</div>',
                // 移动端：二维码下面直接打开支付宝付款（微信不支持截图/相册识别，不提供自动跳转）
                '<div class="xc95Row xc95Btns" id="xc95Jump" hidden style="display:none">',
                '<button type="button" class="xc95Btn ali" id="xc95JumpAli">打开支付宝付款</button>',
                '</div>',
                '<div class="xc95Meta" id="' + META_ID + '"></div>',
                // 四个按钮排成两行，窄面板下也不会被截断
                '<div class="xc95Row xc95Btns xc95Btns2" style="margin-top:5px">',
                '<button type="button" class="xc95Btn" id="' + ZOOM_BTN_ID + '" hidden>放大二维码</button>',
                '<button type="button" class="xc95Btn" id="' + BACKUP_ID + '" hidden>备用二维码</button>',
                '<button type="button" class="xc95Btn" id="' + COPY_ID + '" hidden>复制链接</button>',
                '<button type="button" class="xc95Btn" id="' + OPEN_ID + '" hidden>新标签页打开</button>',
                '</div>',
                '</div>'
            ].join('');

            // 元宝预设
            var presets = panel.querySelector('#xc95Presets');
            YB_PRESETS.forEach(function (v) {
                var chip = document.createElement('span');
                chip.className = 'xc95Chip';
                chip.textContent = String(v);
                chip.setAttribute('data-yb', String(v));
                chip.addEventListener('click', function () {
                    var inp = $('xc95Yb');
                    if (inp) inp.value = String(v);
                    st.yb = String(v);
                    saveSettings();
                    markPresets();
                });
                presets.appendChild(chip);
            });

            // 输入
            ['xc95Account', 'xc95UserId', 'xc95Nick', 'xc95Yb'].forEach(function (id) {
                var el = panel.querySelector('#' + id);
                if (!el) return;
                el.addEventListener('input', function () {
                    readFormIntoState();
                    saveSettings();
                    if (id === 'xc95Yb') markPresets();
                });
            });

            // 支付按钮
            var wx = panel.querySelector('#xc95PayWechat');
            var ali = panel.querySelector('#xc95PayAlipay');
            if (wx) wx.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); onPay('wechat'); });
            if (ali) ali.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); onPay('alipay'); });

            var zoomBtn = panel.querySelector('#' + ZOOM_BTN_ID);
            if (zoomBtn) zoomBtn.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); openZoom(); });
            var copyBtn = panel.querySelector('#' + COPY_ID);
            if (copyBtn) copyBtn.addEventListener('click', function (ev) {
                ev.preventDefault(); ev.stopPropagation();
                if (st.last) copyText(st.last.url);
            });
            var backupBtn = panel.querySelector('#' + BACKUP_ID);
            if (backupBtn) backupBtn.addEventListener('click', function (ev) {
                ev.preventDefault(); ev.stopPropagation();
                toggleBackup();
            });
            var openBtn = panel.querySelector('#' + OPEN_ID);
            if (openBtn) openBtn.addEventListener('click', function (ev) {
                ev.preventDefault(); ev.stopPropagation();
                if (st.last && st.last.kind === 'alipay') window.open(st.last.url, '_blank');
            });
            var jumpAli = panel.querySelector('#xc95JumpAli');
            if (jumpAli) jumpAli.addEventListener('click', function (ev) {
                ev.preventDefault(); ev.stopPropagation(); openPayApp('alipay');
            });

            return panel;
        }

        function markPresets() {
            var wrap = $('xc95Presets');
            if (!wrap) return;
            var chips = wrap.querySelectorAll('.xc95Chip');
            for (var i = 0; i < chips.length; i++) {
                var v = chips[i].getAttribute('data-yb');
                if (v === trim(st.yb)) chips[i].classList.add('on');
                else chips[i].classList.remove('on');
            }
        }

        function syncFormFromState() {
            var map = {
                xc95Account: st.account,
                xc95UserId: st.userId,
                xc95Nick: st.nickname,
                xc95Yb: st.yb
            };
            Object.keys(map).forEach(function (id) {
                var el = $(id);
                if (el && el.value !== map[id]) el.value = map[id];
            });
            markPresets();
        }

        // 工具页内容容器：优先用「已有工具按钮所在的按钮组」，退化用「工具」标签的下一个兄弟
        function findToolContainer() {
            var btns = safe(function () { return document.querySelectorAll('button'); }, []);
            var known = ['聊天表情', '皮肤收集', '战绩出框', '自助观星', '当狗托', '清除红点', '百胜战功', '杀批账本', '秒杀连点', '禁将方案'];
            var i, t;
            for (i = 0; i < btns.length; i++) {
                t = trim(btns[i].textContent);
                if (known.indexOf(t) >= 0) {
                    var group = btns[i].closest ? btns[i].closest('.sSXI3fvBdG') : null;
                    return group || btns[i].parentElement;
                }
            }
            for (i = 0; i < btns.length; i++) {
                if (trim(btns[i].textContent) === '工具' && btns[i].nextElementSibling) {
                    return btns[i].nextElementSibling;
                }
            }
            return null;
        }

        function buildButton() {
            var btn = document.createElement('button');
            btn.id = BTN_ID;
            btn.type = 'button';
            btn.className = 'calRes';
            btn.setAttribute('aria-expanded', 'false');
            btn.textContent = BTN_TEXT;
            btn.addEventListener('click', function (ev) {
                ev.preventDefault();
                if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
                else ev.stopPropagation();
                togglePanel();
            }, true);
            return btn;
        }

        function togglePanel() {
            var panel = $(PANEL_ID);
            var btn = $(BTN_ID);
            if (!panel) return;
            var willOpen = panel.hidden;
            panel.hidden = !willOpen;
            if (btn) btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
            if (willOpen) {
                syncFormFromState();
                refreshAutoFields();
                if (st.last) renderResult();
            }
        }

        function ensureMounted() {
            if (!IS_OFFICIAL) return;
            if (!document.head && !document.documentElement) return;
            ensureStyle();
            var panel = $(PANEL_ID);
            var btn = $(BTN_ID);
            if (panel && btn && document.documentElement.contains(panel)) return;
            var host = findToolContainer();
            if (!host) return;
            if (panel && panel.parentNode) safe(function () { panel.parentNode.removeChild(panel); });
            if (btn && btn.parentNode) safe(function () { btn.parentNode.removeChild(btn); });
            if (!panel) panel = buildPanel();
            if (!btn) btn = buildButton();
            host.appendChild(btn);
            host.appendChild(panel);
            syncFormFromState();
            refreshAutoFields();
            markPresets();
        }

        function tick() {
            safe(ensureMounted);
            safe(refreshAutoFields);
        }

        function boot() {
            if (!IS_OFFICIAL) {
                console.log(TAG, '非官服渠道（' + location.hostname + '），95折充值不启用');
                return;
            }
            loadSettings();
            ensureStyle();
            [80, 300, 900, 2000, 5000].forEach(function (t) { setTimeout(function () { safe(ensureMounted); }, t); });
            // 定时扫描与 DOM 变化后的重挂交给拓展原有的 reinstallAll 主循环（每 3 秒 + 多点定时），
            // 这里不再自己起 setInterval / MutationObserver，避免重复劳动。
            console.log(TAG, '95折充值已启动：工具页 → 95折充值（挂载由拓展主循环维持）');
        }



        return { boot: boot, tick: tick, isOfficial: IS_OFFICIAL };
    })();
    xcRecharge.boot();
    // ============ 13. 盖主速刷（并入自 盖主速刷-1.0.13；挂在「小抄 → 配置 → 游戏辅助」最底下，行/开关样式自绘） ============
    // 单独的工厂函数：隔离世界兼容层会把它的源码整段注入页面主环境再跑一份
    var xcGaiZhuInit = function () {
        'use strict';
        var TAG = '[盖主速刷]';

        // ---- 提示：优先借小抄原生 toast（1.5.98 是 fVeVZlsk），拿不到就自绘 ----
        function showToast(text, color, ms) {
            try {
                const api = window.Uc1cryZVg;
                // 小抄各个版本对 toast 的暴露名不同：1.6.00 是 KONtVeAdczM，1.5.98 是 fVeVZlsk
                if (api) {
                    var keys = ['KONtVeAdczM', 'fVeVZlsk'];
                    for (var i = 0; i < keys.length; i++) {
                        if (typeof api[keys[i]] === 'function') {
                            api[keys[i]](String(text), 'mlqqG6zQWzA', ms || 4000, color || '');
                            return;
                        }
                    }
                }
            } catch (e) {}
            showFallbackToast(text, ms || 4000);
        }

        function showFallbackToast(text, ms) {
            try {
                var body = document.body || document.documentElement;
                if (!body) return;
                var el = document.createElement('div');
                el.textContent = String(text).replace(/<br\s*\/?>/gi, ' ');
                el.style.cssText = [
                    'position:fixed',
                    'left:50%',
                    'top:14%',
                    'transform:translateX(-50%)',
                    'max-width:80vw',
                    'padding:10px 16px',
                    'background:rgba(20,20,20,.9)',
                    'color:#fff',
                    'border-radius:8px',
                    'font-size:13px',
                    'line-height:1.5',
                    'z-index:10000',
                    'box-shadow:0 4px 12px rgba(0,0,0,.35)'
                ].join(';') + ';';
                body.appendChild(el);
                setTimeout(function () { try { if (el.parentNode) el.parentNode.removeChild(el); } catch (e) {} }, ms || 4000);
            } catch (e) {}
        }

        var gzModule = (function () {
        'use strict';

        /* ==================== 常量 ==================== */
        var GZ_TAG = '[盖主速刷]';
        var GZ_STORAGE_KEY = 'xcExt:gaiZhuSpeed';
        // 用 xcGz2* 这套新 id：旧版独立脚本「盖主速刷 1.0.13」用的是 xcExtGz*，
        // 两个都在跑时会同写同一批元素（状态字/勾选来回变）→ 界面狂闪。换 id 各写各的，
        // 同时下面 gzDetectLegacyScript() 会提示把旧脚本删掉。
        var GZ_SECTION_ID = 'xcGz2Section';
        var GZ_ROW_HOST = 'xcGz2RowHost';
        var GZ_ROW_REBEL = 'xcGz2RowRebel';
        var GZ_ROW_DJ = 'xcGz2RowDj';
        var GZ_ROW_WAIT = 'xcGz2RowWait';      // 「等1分钟」开关行
        var GZ_SW_HOST = 'xcGz2SwHost';
        var GZ_SW_REBEL = 'xcGz2SwRebel';
        var GZ_SW_WAIT = 'xcGz2SwWait';
        var GZ_SEG_DJ = 'xcGz2SegDj';          // 「点将（百胜）」三选一分段按钮（不点将 / 随机点将 / 按序点将）
        var GZ_ST_HOST = 'xcGz2StHost';
        var GZ_ST_REBEL = 'xcGz2StRebel';
        var GZ_ST_WAIT = 'xcGz2StWait';
        var GZ_LEGACY_SECTION_ID = 'xcExtGzSection';   // 旧独立脚本的项目块 id（只用来提示）

        // 点将槽位 = 身份序号：0 主公 / 1 忠臣 / 2 反贼 / 3 内奸
        // （小抄 1.6.00 的 Jk = 0x2 是「反贼」：它回包校验用 Figure === Jk + 1，
        //   客户端 sfName 表里 1主公/2忠臣/3反贼/4内奸，所以 Jk=2 → Figure=3 → 反贼；
        //   那是「点将（百胜）」给大号用的槽。盖主（小号）是主公，要动 0 号槽。）
        var GZ_DJ_SLOT_HOST = 0;                // 盖主（小号）：主公槽
        var GZ_DJ_SLOT_REBEL = 2;               // 反贼（大号 · 百胜）：反贼槽
        // 反贼（大号）「点将（百胜）」的三选一模式
        var GZ_DJ_MODE_OFF = 'off';             // 不点将
        var GZ_DJ_MODE_RANDOM = 'random';       // 随机点将（未完成百胜里随机轮换）
        var GZ_DJ_MODE_ORDER = 'order';         // 按序点将（技能战功已完成优先、百胜进度多优先）
        var GZ_DJ_MODES = [GZ_DJ_MODE_OFF, GZ_DJ_MODE_RANDOM, GZ_DJ_MODE_ORDER];
        // 小抄把「技能战功」定义混在百胜战功的同一份配置（Ach）里：flags 0x400 / 0x401，或固定 Id 0x4cd。
        var GZ_SKILL_ACH_FLAGS = [0x400, 0x401];
        var GZ_SKILL_ACH_ID = 0x4cd;
        var GZ_DJ_VERIFY_ATTEMPTS = 12;         // 面板兜底后回校验槽位：12 × 250ms = 3s
        var GZ_DJ_VERIFY_GAP_MS = 250;
        var GZ_SLOT_READ_WAIT_MS = 3000;        // 随机点将：等点将槽可读的最长时间（读不到就先别写）
        var GZ_DJ_PANEL_ATTEMPTS = 8;           // 面板里找目标武将卡片：8 × 600ms
        var GZ_DJ_PANEL_GAP_MS = 600;
        var GZ_TICK_MS = 250;                   // 本模块自己的主心跳（快一点，点将/取消都更及时）
        var GZ_HOST_GENERAL = '黄盖';
        var GZ_KUROU_NAME = '苦肉';
        var GZ_SELECT_TIMEOUT_MS = 20000;       // 选将界面等待上限
        var GZ_SELECT_FALLBACK_MS = 5000;       // 点将模式下等不到目标武将时的兜底时间
        var GZ_SELECT_BOX_ACH_WAIT_MS = 3000;   // 不点将：选将框里等百胜数据的最长时间，超时就随机选
        var GZ_START_RETRY_MAX = 10;            // 开局重试次数
        var GZ_KUROU_MIN_GAP_MS = 600;          // 两次苦肉点击的最小间隔
        var GZ_KUROU_MAX_PER_GAME = 40;
        // ---- 「等1分钟」：盖主（小号）烧条，让每局拖到约 1 分钟 ----
        // 前 45 秒只烧条：出牌倒计时剩 3 秒才点苦肉；45 秒后取消延迟，立刻苦肉收尾。
        var GZ_WAIT_DELAY_MS = 45000;
        var GZ_WAIT_LEFT_SEC = 3;
        var GZ_CD_CACHE_MS = 500;               // 倒计时对象缓存（每拍都 getInstance + 整树扫描太亏）
        var GZ_CANCEL_MAX_PER_GAME = 20;
        var GZ_TRUSTEE_RETRY_MS = 3000;
        var GZ_TRUSTEE_MAX = 5;
        var GZ_ACH_TIMEOUT_MS = 8000;
        var GZ_AI_LABEL_PREFS = ['小杀(普通)', '普通', '小杀'];
        // ---- 手气卡弹窗：控制台日志里是「打开弹窗ShouQiKaAskWindow」，认窗口名最准 ----
        var GZ_ML_WINDOW_NAMES = ['ShouQiKaAskWindow'];
        var GZ_ML_WINDOW_RE = /ShouQiKa|手气卡|FirstHand|Mulligan/i;
        var GZ_ML_KEYWORD_RE = /手气卡|更换.{0,4}手牌|替换.{0,6}手牌|换手牌/;
        var GZ_ML_DECLINE_LABELS = ['取消', '不使用', '不用', '关闭', '否', '放弃', '跳过'];
        var GZ_ML_DECLINE_RE = /取消|不使用|不用|关闭|放弃|跳过/;
        // 「使用/更换手气卡」那一侧：认出来后绝不点它，只用来反向确认它的对面才是拒绝
        var GZ_ML_USE_RE = /使用|更换|替换|确定|确认|^是$|^好$/;
        var GZ_ML_MAX_SAME = 3;      // 同一条手气卡提示最多点几次，点不掉就停手
        // ---- 手气卡守备：开局这段时间内不开托管（托管/自动状态会让客户端自己把手气卡用掉） ----
        var GZ_ML_TRUSTEE_GUARD_MS = 20000;  // 进局后 20 秒内不开托管；每次发现手气卡提示再顺延
        var GZ_ML_POST_SELECT_GUARD_MS = 10000; // 选将完成后再等 10 秒（手气卡常在这之后弹出）
        var GZ_ML_TRUSTEE_SEEN_MS = 3000;    // 刚看到过手气卡提示的 3 秒内也不开
        var GZ_ML_RISK_MS = 20000;           // 进局后 20 秒：整树扫描不降速，尽量第一时间认出弹窗
        // ---- 房间「开启点将」 ----
        var GZ_OD_NAME_RE = /开启点将/;
        var GZ_OD_ANY_RE = /点将/;
        var GZ_OD_ON_RE = /关闭点将/;
        var GZ_OD_MAX_TRIES = 3;     // 同一房间最多点几次
        var GZ_OD_GAP_MS = 1500;     // 第一次点立刻生效；只有「点了没反应」才等这么久再补点
        var GZ_OD_MAX_MISS = 6;      // 找不到按钮最多空转几次
        var GZ_CONTINUE_TEXT_RE = /点击|空白|继续|任意/;
        var GZ_SELECT_WINDOW_RE = /^Select.*General.*Window$/;
        var GZ_SELECT_WINDOW_SKIP = ['SelectCountryWarGeneralWindow'];
        // 点将界面（房间里的那种）也带武将卡，别被选将逻辑误当成「开局选将」
        var GZ_DIANJIANG_NAME_RE = /DianJiang|点将/;
        var GZ_LAYER_ORDER = ['BottomLayer', 'BackgroundLayer', 'SceneLayer', 'AnimationLayer',
            'WindowLayer', 'TopUILayer', 'PromptLayer'];
        // 小抄自带、会和本功能抢操作的开关（自动挂机 / 盖主速刷）
        var GZ_XC_CONFLICT_IDS = ['NrFZgZ8LKo', 'XBceFySYs'];

        /* ==================== 基础工具 ==================== */
        function gzTrim(v) {
            return String(v == null ? '' : v).replace(/^[\s\u00a0]+|[\s\u00a0]+$/g, '');
        }

        function gzLog() {
            try {
                console.log.apply(console, [GZ_TAG].concat(Array.prototype.slice.call(arguments)));
            } catch (e) {}
        }

        function gzWarn() {
            try {
                console.warn.apply(console, [GZ_TAG].concat(Array.prototype.slice.call(arguments)));
            } catch (e) {}
        }

        // 等价小抄的 CH(fn, 次数, 间隔)：反复调用 fn 直到返回真值
        function gzWaitFor(fn, attempts, gapMs, aliveFn) {
            return new Promise(function (resolve) {
                var left = Number(attempts) > 0 ? Number(attempts) : 1;
                var gap = Number(gapMs) > 0 ? Number(gapMs) : 100;
                function step() {
                    var v = null;
                    try { v = fn(); } catch (e) { v = null; }
                    if (v) { resolve(v); return; }
                    if (aliveFn && !aliveFn()) { resolve(null); return; }
                    left -= 1;
                    if (left <= 0) { resolve(null); return; }
                    setTimeout(step, gap);
                }
                step();
            });
        }

        function gzNum() {
            for (var i = 0; i < arguments.length; i++) {
                var v = arguments[i];
                if (v === null || v === undefined || v === '') continue;
                var n = Number(v);
                if (isFinite(n)) return n;
            }
            return 0;
        }

        // 按钮/技能节点是否可点（移植小抄的 uf：destroyed / visible / _enabled）
        function gzUsable(node) {
            if (!node || node.destroyed) return false;
            if (node.visible === false) return false;
            if (node._enabled === true) return true;
            if (node._enabled === false) return false;
            return node.enabled !== false;
        }

        function gzDispatchChange(el) {
            if (!el) return;
            try {
                var ev = document.createEvent('HTMLEvents');
                ev.initEvent('change', true, true);
                el.dispatchEvent(ev);
                return;
            } catch (e) {}
            try { if (typeof el.onchange === 'function') el.onchange(); } catch (e2) {}
        }

        function gzPickField(o, keys) {
            if (o == null) return undefined;
            for (var i = 0; i < keys.length; i++) {
                var v = o[keys[i]];
                if (v !== undefined && v !== null) return v;
            }
            return undefined;
        }

        /* ==================== 游戏桥接（移植小抄 Dl 门面） ====================
         * 只保留本功能需要的部分：
         *   class(name)  —— 通过 Laya.ClassUtils + 事件监听者(caller)启发式拿到游戏类实例
         *   scene()      —— SceneManager.CurrentScene，退化到 Laya.stage 的 SceneLayer
         *   gamescene()  —— SceneManager.IsGameScene 时的当前场景
         *   win(name)    —— WindowManager.WindowInstanceDict
         *   click(node)  —— 小抄的 Dl.click：优先 onMouse({type})，其次 event()
         * 所有取值都包 try/catch，拿不到返回 null，由状态机等待重试。
         * ================================================================== */
        var GAME = (function () {
            var instCache = {};
            var classCache = {};

            function laya() {
                try { return window.Laya || null; } catch (e) { return null; }
            }

            // 等价小抄 Dl.get 的 Laya.ClassUtils.getInstance 分支（这里统一缓存保活）
            function getInstance(name, arg) {
                if (instCache[name]) return instCache[name];
                var L = laya();
                if (!L || !L.ClassUtils || typeof L.ClassUtils.getInstance !== 'function') return null;
                try {
                    var o = L.ClassUtils.getInstance(name, arg === undefined ? null : arg);
                    if (o) instCache[name] = o;
                    return o || null;
                } catch (e) {
                    return null;
                }
            }

            // 等价小抄 Dl.caller：从某个实例的事件监听里反查监听者对象
            function callerFor(ownerName, evtName) {
                var owner = klass(ownerName);
                var events = null;
                try { events = (owner && owner._events) || null; } catch (e) { events = null; }
                if (!events) return null;
                var handler = events[evtName];
                if (!handler) return null;
                var list = Object.prototype.toString.call(handler) === '[object Array]' ? handler : [handler];
                for (var i = 0; i < list.length; i++) {
                    var caller = list[i] && list[i].caller;
                    if (caller) return caller;
                }
                return null;
            }

            function childList(node) {
                try {
                    var kids = node && node._children;
                    if (!kids) return [];
                    var out = [];
                    for (var i = 0; i < kids.length; i++) if (kids[i]) out.push(kids[i]);
                    return out;
                } catch (e) { return []; }
            }

            function findByLayerOrder(root, name) {
                var idx = GZ_LAYER_ORDER.indexOf(name);
                if (idx < 0 || !root) return null;
                var kids = childList(root);
                for (var i = 0; i < kids.length; i++) {
                    try { if (kids[i].layerOrder === idx) return kids[i]; } catch (e) {}
                }
                return null;
            }

            function findByClass(root, name) {
                if (!root) return null;
                var queue = [root];
                var guard = 0;
                while (queue.length && guard < 3000) {
                    guard += 1;
                    var node = queue.shift();
                    var kids = childList(node);
                    for (var i = 0; i < kids.length; i++) {
                        var c = kids[i];
                        var cname = '';
                        try { cname = (c.constructor && c.constructor.name) || ''; } catch (e) {}
                        if (c.name === name || c.sceneName === name || cname === name) return c;
                        queue.push(c);
                    }
                }
                return null;
            }

            function klass(name) {
                if (classCache[name]) return classCache[name];
                var r = null;
                try {
                    switch (name) {
                        case 'GameEventDispatcher': {
                            var popup = getInstance('PopUpWindow', null);
                            r = (popup && popup.ged) || null;
                            break;
                        }
                        case 'WindowManager':
                            r = callerFor('GameEventDispatcher', 'HIDE_WINDOW');
                            break;
                        case 'ServerProxy': {
                            var wm = klass('WindowManager');
                            r = (wm && wm.proxy) || null;
                            break;
                        }
                        case 'SceneManager':
                            r = callerFor('GameEventDispatcher', 'SWITCH_SCENE');
                            break;
                        case 'AchievementManager':
                            r = callerFor('ServerProxy', 'ClientDbsGetuserachinfoRep');
                            break;
                        case 'GameGeneralManager':
                            r = callerFor('ServerProxy', 'ClientGeneralFromRep');
                            break;
                        case 'PromptLayer': {
                            var tip = getInstance('FcmTipWindow', null);
                            r = (tip && tip.ParentLayerInstance) || null;
                            break;
                        }
                        case 'UserData': {
                            var wish = getInstance('BirthdayWishWin', null);
                            var ud = (wish && wish.userData) || null;
                            r = (ud && ud.__proto__ && ud.__proto__.constructor) || null;
                            break;
                        }
                        default:
                            r = null;
                    }
                } catch (e) { r = null; }
                if (r) classCache[name] = r;
                return r;
            }

            function sceneFromStage() {
                var L = laya();
                if (!L || !L.stage) return null;
                var layer = findByLayerOrder(L.stage, 'SceneLayer');
                if (!layer) return null;
                var kids = childList(layer).filter(function (n) { return n && n.visible !== false; });
                return kids.length ? kids[kids.length - 1] : null;
            }

            function scene() {
                try {
                    var sm = klass('SceneManager');
                    if (sm && sm.CurrentScene) return sm.CurrentScene;
                } catch (e) {}
                return sceneFromStage();
            }

            function gamescene() {
                var sc = scene();
                try {
                    var sm = klass('SceneManager');
                    if (sm && sm.IsGameScene) return sc;
                } catch (e) {}
                if (sc && (sc.SceneName === 'GameScene' || sc.name === 'GameScene')) return sc;
                if (sc && sc.SelfSeatUi) return sc;
                return null;
            }

            function windowDict() {
                var wm = klass('WindowManager');
                try { return (wm && wm.WindowInstanceDict) || null; } catch (e) { return null; }
            }

            function win(name) {
                var dict = windowDict();
                var w = null;
                try {
                    if (dict && typeof dict.get === 'function') w = dict.get(name);
                    else if (dict && dict._maps) w = dict._maps[name];
                    else if (dict && dict[name]) w = dict[name];
                } catch (e) { w = null; }
                if (w) return w;
                var L = laya();
                if (!L || !L.stage) return null;
                var layer = findByLayerOrder(L.stage, 'WindowLayer');
                return layer ? findByClass(layer, name) : null;
            }

            function allWindows() {
                var out = [];
                var dict = windowDict();
                try {
                    if (dict && typeof dict.entries === 'function') {
                        var it = dict.entries();
                        var kv = it.next();
                        while (!kv.done) {
                            if (kv.value && kv.value[1]) out.push({ name: String(kv.value[0] || ''), win: kv.value[1] });
                            kv = it.next();
                        }
                    } else if (dict && typeof dict.values === 'function') {
                        var it2 = dict.values();
                        var v = it2.next();
                        while (!v.done) {
                            if (v.value) out.push({ name: String(v.value.name || ''), win: v.value });
                            v = it2.next();
                        }
                    } else if (dict && typeof dict === 'object') {
                        var maps = (dict._maps && typeof dict._maps === 'object') ? dict._maps : dict;
                        Object.keys(maps).forEach(function (k) {
                            if (maps[k] && typeof maps[k] === 'object') out.push({ name: String(k), win: maps[k] });
                        });
                    }
                } catch (e) {}
                if (!out.length) {
                    ['DianJiangWindow', 'SelectGeneralWindow', 'SelectGeneralHappyWindow',
                        'SelectGeneralHappyNewWindow', 'SelectGeneralRogue1v1Window'].forEach(function (nm) {
                        var w = win(nm);
                        if (w) out.push({ name: nm, win: w });
                    });
                }
                return out;
            }

            // 小抄 Dl.click：优先 onMouse({type})，其次 event()
            function click(node, type) {
                if (!node) return false;
                var t = type || 'click';
                try {
                    if (typeof node.onMouse === 'function') { node.onMouse({ type: t }); return true; }
                } catch (e) {}
                try {
                    if (typeof node.event === 'function') { node.event(t, t === 'click' ? node.name : node); return true; }
                } catch (e) {}
                try {
                    if (typeof node.onClick === 'function') { node.onClick(); return true; }
                } catch (e) {}
                return false;
            }

            // 按钮类节点：小抄对 buttonBar / sureBtn 都是直接调 onClick()
            function pressButton(node) {
                if (!node) return false;
                try {
                    if (typeof node.onClick === 'function') { node.onClick(); return true; }
                } catch (e) {}
                return click(node);
            }

            return {
                laya: laya,
                klass: klass,
                getInstance: getInstance,
                scene: scene,
                gamescene: gamescene,
                win: win,
                allWindows: allWindows,
                click: click,
                pressButton: pressButton
            };
        })();

        /* ==================== 游戏消息（console.log 通道） ==================== */
        var gzMessageHandlers = {};
        var gzConsoleHooked = false;
        var gzTimer = 0;

        function gzOn(name, fn) {
            if (!gzMessageHandlers[name]) gzMessageHandlers[name] = [];
            gzMessageHandlers[name].push(fn);
        }

        function gzOnConsoleArgs() {
            try {
                var args = arguments;
                if (!args || !args.length) return;
                var last = args[args.length - 1];
                if (last === 'EXIT') { gzConsoleHooked = false; return; }
                // 文本型日志：游戏自己会打印「打开弹窗ShouQiKaAskWindow」这类窗口日志。
                // 直接拿它当手气卡的即时触发——只靠 250ms 轮询 + 800ms 限速的深层扫描会慢半拍，
                // 偶尔还没把弹窗拒掉，游戏就把手气卡走了。
                var txt = '';
                for (var a = 0; a < args.length; a++) {
                    if (typeof args[a] === 'string') txt += args[a];
                }
                if (txt && GZ_ML_HINT_RE.test(txt)) gzMlNotice(txt);
                if (!last || typeof last !== 'object') return;
                var name = String(last.className || last.ClassName || '');
                if (!name) return;
                var list = gzMessageHandlers[name];
                if (!list || !list.length) return;
                for (var i = 0; i < list.length; i++) {
                    try { list[i](last); } catch (e) { gzWarn('处理消息 ' + name + ' 失败', e); }
                }
            } catch (e) {}
        }

        // 小抄把游戏 console.log 里的消息对象通过 window.VIiR0YfvE4s 分发出来。
        // 只往这个公开数组里补挂（每拍检查、被小抄重建/清空后能补回）；
        // **绝不包 console.log** —— 小抄自己的整条消息管道就挂在 console.log 上，
        // 包了会把它顶掉（小抄自带的百胜战功也会跟着出错）。
        function gzEnsureEventHook() {
            var arr = null;
            try { arr = window.VIiR0YfvE4s; } catch (e) { arr = null; }
            if (arr && typeof arr.push === 'function') {
                var found = false;
                try {
                    for (var i = 0; i < arr.length; i++) if (arr[i] === gzOnConsoleArgs) { found = true; break; }
                } catch (e) {}
                if (!found) { try { arr.push(gzOnConsoleArgs); } catch (e2) {} }
            }
            gzEnsureReplyHook();
        }

        // 回包的第二个来源：把「已经存在的、caller 就是 AchievementManager 的」回包处理函数包一层。
        // 不新增 caller、不改事件表结构，所以小抄按 caller 反查管理者的启发式不受影响。
        var gzReplyWrapped = 0;

        function gzWrapReplyEntry(entry) {
            var method = null, key = null, caller = null;
            try {
                if (entry && typeof entry === 'object') {
                    if (typeof entry.method === 'function') { method = entry.method; key = 'method'; }
                    else if (typeof entry[1] === 'function') { method = entry[1]; key = 1; }
                    caller = entry.caller || (Object.prototype.toString.call(entry) === '[object Array]' ? entry[0] : null);
                }
            } catch (e) { method = null; }
            if (!caller || typeof caller.sendGetAchInfo !== 'function') return false;
            if (!method || method.__xcGzWrapped) return false;
            var wrapped = function () {
                try { if (arguments.length) gzHandleAchReply(arguments[0], 'event'); } catch (e) {}
                return method.apply(this, arguments);
            };
            try { wrapped.__xcGzWrapped = true; wrapped.__xcGzOrig = method; } catch (e) {}
            try {
                if (key === 'method') entry.method = wrapped; else entry[1] = wrapped;
                gzReplyWrapped += 1;
                return true;
            } catch (e) { return false; }
        }

        function gzEnsureReplyHook() {
            var sp = null;
            try { var wm = GAME.klass('WindowManager'); sp = wm && wm.proxy; } catch (e) { sp = null; }
            if (!sp) return;
            var list = null;
            try { list = sp._events && sp._events['ClientDbsGetuserachinfoRep']; } catch (e) { list = null; }
            if (!list) return;
            var arr = Object.prototype.toString.call(list) === '[object Array]' ? list : [list];
            for (var i = 0; i < arr.length; i++) {
                try { gzWrapReplyEntry(arr[i]); } catch (e) {}
            }
        }

        /* ==================== 昵称 / 账号 ==================== */
        var gzNickCache = '';

        function gzHudNickname() {
            try {
                var nodes = document.querySelectorAll('div');
                for (var i = 0; i < nodes.length; i++) {
                    var el = nodes[i];
                    if (el.children && el.children.length) continue;
                    var text = gzTrim(el.textContent);
                    if (!text || text.length > 40) continue;
                    var m = text.match(/^昵称\s*[：:]\s*(\S.*)$/);
                    if (m) return gzTrim(m[1]);
                }
            } catch (e) {}
            return '';
        }

        // 等价小抄 iO()：UserData.Self.nickname / NickName
        function gzNickname() {
            if (gzNickCache) return gzNickCache;
            var name = '';
            try {
                var ud = GAME.klass('UserData');
                var self = ud && ud.Self;
                name = gzTrim((self && (self.nickname || self.NickName)) || '');
            } catch (e) {}
            if (!name) {
                try {
                    var wish = GAME.getInstance('BirthdayWishWin', null);
                    var u = wish && wish.userData;
                    name = gzTrim((u && (u.nickname || u.NickName)) || '');
                } catch (e) {}
            }
            if (!name) name = gzHudNickname();
            if (name) gzNickCache = name;
            return name;
        }

        // 小抄 HUD 的「id：数字」兜底（和 95折充值面板同一套读法）
        function gzHudUserId() {
            try {
                var nodes = document.querySelectorAll('div');
                for (var i = 0; i < nodes.length; i++) {
                    var el = nodes[i];
                    if (el.children && el.children.length) continue;
                    var text = gzTrim(el.textContent);
                    if (!text || text.length > 40) continue;
                    var m = text.match(/^id\s*[：:]\s*(\d{6,12})$/);
                    if (m) return gzNum(m[1]);
                }
            } catch (e) {}
            return 0;
        }

        function gzMyUserId() {
            var id = 0;
            try {
                var ud = GAME.klass('UserData');
                var self = ud && ud.Self;
                id = gzNum(self && (self.userID || self.UserID || self.userId));
            } catch (e) { id = 0; }
            if (!(id > 0)) id = gzHudUserId();
            return id;
        }

        /* ==================== 百胜战功数据 ==================== */
        var gzAch = {
            seq: 0,
            pending: null,      // { id, nickname, reason, resolve, promise, timer, done }
            snapshot: null,     // { nickname, receivedAt, finishTimes, criteriaProgress }
            evaluated: null,    // { completed:{}, details:{}, unfinished:[], all:[] }
            diag: { replies: 0, lastChan: '', parseFail: 0, sample: '' }
        };

        function gzZk() {
            // 小抄把配置挂在 window.Uc1cryZVg 下的名字随版本变（1.6.00 是 Fgs8jR5fMdm、
            // 1.5.98 是 vCk1gH8JL，别的版本又是别的名字），所以不认名字、只认结构：
            // 谁能读出「条目带 characterId + criteriaEntry」的数组，谁就是百胜战功配置。
            if (gzCfg.obj && gzCfg.score >= 20) return gzCfg.obj;
            var cs = gzCfgCandidates();
            var names = ['Fgs8jR5fMdm', 'vCk1gH8JL'], i, j;
            for (i = 0; i < cs.length; i++) {
                for (j = 0; j < names.length; j++) {
                    if (cs[i].name === names[j] && gzAchArrayOf(cs[i].obj)) {
                        gzCfg.obj = cs[i].obj; gzCfg.from = names[j]; gzCfg.score = gzAchScore(cs[i].obj);
                        return gzCfg.obj;
                    }
                }
            }
            var best = null, bestScore = -1, bestName = '';
            for (i = 0; i < cs.length; i++) {
                var s = gzAchScore(cs[i].obj);
                var hasDict = false;
                try { hasDict = !!cs[i].obj.generalDict; } catch (e) {}
                if (s > bestScore || (s === bestScore && hasDict)) { best = cs[i].obj; bestScore = s; bestName = cs[i].name; }
            }
            if (best) {
                gzCfg.obj = best; gzCfg.score = bestScore; gzCfg.from = bestName || 'scan';
                var tip = [];
                for (i = 0; i < cs.length && i < 8; i++) {
                    var a = gzAchArrayOf(cs[i].obj), dict = '无';
                    try { if (cs[i].obj.generalDict) dict = '有'; } catch (e) {}
                    tip.push(cs[i].name + '[Ach:' + (a ? a.length : '无') + ',dict:' + dict + ',score:' + gzAchScore(cs[i].obj) + ']');
                }
                gzCfg.cand = tip.join(' / ');
            }
            return best;
        }

        var gzCfg = { obj: null, from: '', score: 0, cand: '' };
        var gzCfgScan = { at: 0, list: [] };
        var GZ_ACH_KEY_NAMES = ['Ach', 'ach', 'Achs', 'achievements', 'achieveList'];

        function gzIsArr(v) {
            return Object.prototype.toString.call(v) === '[object Array]';
        }

        function gzCfgCandidates() {
            var now = Date.now();
            if (gzCfgScan.list.length && (now - gzCfgScan.at) < 2000) return gzCfgScan.list;
            var out = [], seen = [];
            function add(name, obj) {
                if (!obj || typeof obj !== 'object') return;
                for (var i = 0; i < seen.length; i++) if (seen[i] === obj) return;
                seen.push(obj);
                out.push({ name: name, obj: obj });
            }
            var api = null;
            try { api = window.Uc1cryZVg; } catch (e) { api = null; }
            if (api && typeof api === 'object') {
                add('Uc1cryZVg', api);
                var n = 0;
                for (var k in api) {
                    if (n++ > 120) break;
                    var v = null;
                    try { v = api[k]; } catch (e) { v = null; }
                    if (!v || typeof v !== 'object') continue;
                    add(String(k), v);
                    if (!v.generalDict && !gzAchArrayOf(v)) continue;
                    var m = 0;
                    for (var k2 in v) {
                        if (m++ > 40) break;
                        try {
                            var v2 = v[k2];
                            if (v2 && typeof v2 === 'object' && (v2.generalDict || gzAchArrayOf(v2))) add(k + '.' + k2, v2);
                        } catch (e) {}
                    }
                }
            }
            if (!api) {
                var n3 = 0;
                for (var k3 in window) {
                    if (n3++ > 3000) break;
                    try {
                        var v3 = window[k3];
                        if (v3 && typeof v3 === 'object' && gzAchArrayOf(v3)) add('window.' + k3, v3);
                    } catch (e) {}
                }
            }
            gzCfgScan.list = out;
            gzCfgScan.at = now;
            return out;
        }

        // 这个对象里「百胜战功定义」的数组：优先固定名，其次任一「条目带 characterId」的数组
        function gzAchArrayOf(o) {
            if (!o || typeof o !== 'object') return null;
            var i, v;
            for (i = 0; i < GZ_ACH_KEY_NAMES.length; i++) {
                try { v = o[GZ_ACH_KEY_NAMES[i]]; } catch (e) { v = null; }
                if (gzIsArr(v) && v.length) return v;
            }
            var n = 0;
            for (var k in o) {
                if (n++ > 80) break;
                try {
                    v = o[k];
                    if (!gzIsArr(v) || !v.length) continue;
                    var e0 = v[0];
                    if (!e0 || typeof e0 !== 'object') continue;
                    if (gzNum(e0.characterId, e0.CharacterId) > 0 &&
                        (gzIsArr(e0.criteriaEntry) || e0.criteriaEntry || e0.flags !== undefined)) return v;
                } catch (e) {}
            }
            return null;
        }

        function gzAchScore(o) {
            var a = gzAchArrayOf(o);
            if (!a) return 0;
            var lim = Math.min(a.length, 3000), n800 = 0, nCrit = 0;
            for (var i = 0; i < lim; i++) {
                var d = a[i];
                if (!d) continue;
                if (Number(d.flags) === 0x800) n800 += 1;
                else if (gzNum(d.characterId, d.CharacterId) > 0 && gzIsArr(d.criteriaEntry)) nCrit += 1;
            }
            if (n800 > 0) return 30 + n800;
            if (nCrit > 0) return 20 + nCrit;
            return 5 + a.length;
        }

        // 百胜战功定义：flags === 0x800 的那些（退到「有 characterId + criteriaEntry」的）
        function gzAchDefs() {
            var ach = gzAchArrayOf(gzZk());
            if (!ach || !ach.length) return null;
            var out = [];
            for (var i = 0; i < ach.length; i++) {
                if (Number(ach[i] && ach[i].flags) === 0x800) out.push(ach[i]);
            }
            if (out.length) return out;
            for (var j = 0; j < ach.length; j++) {
                var d = ach[j];
                if (d && gzNum(d.characterId, d.CharacterId) > 0 && gzIsArr(d.criteriaEntry)) out.push(d);
            }
            return out.length ? out : null;
        }

        function gzGeneralDict() {
            var zk = gzZk(), d = null;
            try { d = zk && zk.generalDict; } catch (e) { d = null; }
            if (d) return d;
            var cs = gzCfgCandidates();
            for (var i = 0; i < cs.length; i++) {
                try { if (cs[i].obj.generalDict) return cs[i].obj.generalDict; } catch (e) {}
            }
            return null;
        }

        function gzOwnsGeneral(id) {
            var gm = GAME.klass('GameGeneralManager');
            if (!gm || typeof gm.HasGeneral !== 'function') return true;   // 拿不到就当拥有
            try { return !!gm.HasGeneral(Number(id)); } catch (e) { return true; }
        }

        function gzGeneralIdByName(name) {
            var dict = gzGeneralDict();
            if (!dict) return 0;
            var ids = [];
            for (var k in dict) {
                if (!Object.prototype.hasOwnProperty.call(dict, k)) continue;
                if (String(dict[k]) === String(name)) ids.push(Number(k));
            }
            if (!ids.length) return 0;
            ids.sort(function (a, b) { return a - b; });
            for (var i = 0; i < ids.length; i++) if (gzOwnsGeneral(ids[i])) return ids[i];
            return ids[0];
        }

        function gzGeneralNameById(id) {
            var dict = gzGeneralDict();
            if (dict && dict[id] != null) return String(dict[id]);
            return String(id);
        }

        // 回包可能被游戏包在 ProtoObj / data / msg / result … 里，逐层找「带 Achs 的那个对象」
        var GZ_REPLY_KEYS = ['Achs', 'achs'];
        var GZ_REPLY_WRAP = ['ProtoObj', 'protoObj', 'proto', 'Proto', 'data', 'Data', 'msg', 'Msg',
            'message', 'Message', 'body', 'Body', 'params', 'Params', 'payload', 'Payload',
            'result', 'Result', 'rep', 'Rep', 'info', 'Info', 'value', 'Value'];

        function gzFindAchList(o, depth) {
            if (!o || typeof o !== 'object' || depth > 3) return null;
            var i, v;
            for (i = 0; i < GZ_REPLY_KEYS.length; i++) {
                try { v = o[GZ_REPLY_KEYS[i]]; } catch (e) { v = null; }
                if (gzIsArr(v)) return { node: o, list: v };
            }
            for (i = 0; i < GZ_REPLY_WRAP.length; i++) {
                try { v = o[GZ_REPLY_WRAP[i]]; } catch (e) { v = null; }
                if (v && typeof v === 'object') {
                    var r = gzFindAchList(v, depth + 1);
                    if (r) return r;
                }
            }
            return null;
        }

        function gzDescribeObj(o) {
            try {
                if (o == null) return String(o);
                if (typeof o !== 'object') return typeof o + ':' + String(o).slice(0, 30);
                var cls = String(o.className || o.ClassName || '');
                var keys = [], n = 0;
                for (var k in o) { if (n++ >= 14) break; keys.push(k); }
                return (cls ? cls + ' ' : '') + '{' + keys.join(',') + '}';
            } catch (e) { return '(?)'; }
        }

        // 移植小抄 wD：解析 ClientDbsGetuserachinfoRep（结构不认死）
        function gzAchParse(raw, nickname) {
            if (!raw || typeof raw !== 'object') return null;
            var found = gzFindAchList(raw, 0);
            if (!found && gzIsArr(raw) && raw.length && raw[0] && typeof raw[0] === 'object' &&
                (raw[0].id !== undefined || raw[0].ID !== undefined)) found = { node: {}, list: raw };
            if (!found) return null;
            var node = found.node, list = found.list;
            var nick = gzTrim(gzPickField(node, ['NickName', 'nickName', 'nickname', 'Name', 'name']) || '');
            if (nickname && nick && nick !== nickname) {
                // 只告警不丢包：同一时刻只发了一条请求
                gzWarn('百胜回包昵称与本地昵称不一致（本地 ' + nickname + ' / 回包 ' + nick + '），按同一请求处理');
            }
            var finishTimes = {};
            var criteriaProgress = {};
            for (var i = 0; i < list.length; i++) {
                var item = list[i];
                if (!item) continue;
                var b = item.ProtoObj || item.protoObj || item;
                var id = gzNum(b.id, b.ID);
                var type = gzNum(b.type, b.Type);
                var detail = gzNum(b.detailInfo, b.DetailInfo);
                if (!(id > 0)) continue;
                if ((type & 1) && detail > 0) {
                    finishTimes[id] = Math.max(Number(finishTimes[id]) || 0, detail);
                } else if ((type & 2) && detail >= 0) {
                    criteriaProgress[id] = Math.max(Number(criteriaProgress[id]) || 0, detail);
                }
            }
            return {
                nickname: nick || nickname || '',
                receivedAt: Date.now(),
                source: 'ClientDbsGetuserachinfoRep',
                finishTimes: finishTimes,
                criteriaProgress: criteriaProgress
            };
        }

        // 移植小抄 wX：一条百胜战功需要的次数
        function gzAchRequired(def) {
            var entries = (def && def.criteriaEntry) || [];
            var total = 0;
            for (var i = 0; i < entries.length; i++) {
                var count = gzNum(entries[i] && entries[i].count);
                if (count > 0) total += count;
            }
            return total;
        }

        // 移植小抄 ww：把快照换算成「已完成 / 详情 / 未完成」
        function gzAchEvaluate(snapshot) {
            if (!snapshot) return null;
            var defs = gzAchDefs();
            if (!defs || !defs.length) return null;
            var dict = gzGeneralDict();
            var completed = {};
            var details = {};
            var all = [];
            for (var i = 0; i < defs.length; i++) {
                var def = defs[i] || {};
                var cid = gzNum(def.characterId, def.CharacterId);
                var aid = gzNum(def.Id, def.id);
                if (!(cid > 0) || !(aid > 0)) continue;
                var required = gzAchRequired(def);
                var progress = 0;
                var entries = def.criteriaEntry || [];
                for (var j = 0; j < entries.length; j++) {
                    var entry = entries[j] || {};
                    var criteriaId = gzNum(entry.Id, entry.id);
                    if (criteriaId > 0) {
                        progress += Math.max(0, Number(snapshot.criteriaProgress[criteriaId]) || 0);
                    }
                }
                var finishTime = Number(snapshot.finishTimes[aid]) || 0;
                var done = finishTime > 0 || (required > 0 && progress >= required);
                var prev = details[cid];
                if (!prev || progress > prev.progress || (done && !prev.completed)) {
                    details[cid] = {
                        achievementId: aid,
                        progress: progress,
                        required: required,
                        finishTime: finishTime,
                        completed: done,
                        name: (dict && dict[cid]) || String(cid)
                    };
                }
                if (done) completed[cid] = true;
                if (all.indexOf(cid) < 0) all.push(cid);
            }
            if (!all.length) return null;
            var unfinished = [];
            for (var k = 0; k < all.length; k++) {
                if (completed[all[k]]) continue;
                if (!gzOwnsGeneral(all[k])) continue;
                if (gzIsRebelBannedGeneral(all[k])) continue;   // 反贼不点黄盖/界黄盖（小号就是黄盖）
                unfinished.push(all[k]);
            }
            return { completed: completed, details: details, unfinished: unfinished, all: all };
        }

        // 反贼不选黄盖/界黄盖：小号（盖主）用的就是黄盖，同一局里不能有两个黄盖。
        // 按「武将名」判断（id 随版本变），顺手把各种黄盖变体（界黄盖/SP黄盖…）一起挡掉。
        function gzIsRebelBannedGeneral(id) {
            var name = '';
            try { name = gzGeneralNameById(id); } catch (e) { name = ''; }
            return String(name).indexOf('黄盖') >= 0;
        }

        function gzAchFinish(req, snapshot) {
            if (!req || req.done) return;
            req.done = true;
            try { clearTimeout(req.timer); } catch (e) {}
            if (gzAch.pending === req) gzAch.pending = null;
            req.resolve(snapshot || null);
        }

        // 移植小抄 wK：AchievementManager.sendGetAchInfo(昵称, 0) + 等 ClientDbsGetuserachinfoRep
        function gzAchDiag() {
            try {
                var defs = gzAchDefs();
                var hasArr = false;
                try { hasArr = !!(window.VIiR0YfvE4s && window.VIiR0YfvE4s.push); } catch (e) {}
                gzWarn('百胜诊断：配置来源=' + (gzCfg.from || '无') +
                    '，定义=' + ((defs && defs.length) || 0) + ' 条' +
                    (gzCfg.cand ? '，候选：' + gzCfg.cand : '') +
                    '，console监听=' + (hasArr ? '已挂' : '无') +
                    '，包住回包处理=' + gzReplyWrapped +
                    '，收到回包=' + gzAch.diag.replies + '（' + (gzAch.diag.lastChan || '-') + '）' +
                    '，解析失败=' + gzAch.diag.parseFail +
                    (gzAch.diag.sample ? '，回包样本=' + gzAch.diag.sample : ''));
            } catch (e) {}
        }

        function gzAchQuery(reason) {
            if (!gzAchDefs()) {
                gzWarn('百胜战功定义还没读到（小抄配置未加载），稍后重试');
                gzAchDiag();
                return Promise.resolve(null);
            }
            var mgr = GAME.klass('AchievementManager');
            var nick = gzNickname();
            if (!mgr || typeof mgr.sendGetAchInfo !== 'function' || !nick) {
                gzWarn('百胜战功数据没法查询（' + (!mgr ? '找不到 AchievementManager'
                    : (typeof mgr.sendGetAchInfo !== 'function' ? '没有 sendGetAchInfo' : '拿不到昵称')) + '）');
                gzAchDiag();
                return Promise.resolve(null);
            }
            gzEnsureEventHook();
            var old = gzAch.pending;
            if (old && old.nickname === nick) return old.promise;
            if (old) gzAchFinish(old, null);
            var resolver = null;
            var promise = new Promise(function (resolve) { resolver = resolve; });
            var req = {
                id: ++gzAch.seq,
                nickname: nick,
                reason: reason || 'auto',
                resolve: resolver,
                promise: promise,
                timer: 0,
                done: false
            };
            gzAch.pending = req;
            req.timer = setTimeout(function () {
                if (req.done) return;
                gzWarn('百胜战功数据请求超时（' + req.reason + '）');
                gzAchDiag();
                gzAchFinish(req, null);
            }, GZ_ACH_TIMEOUT_MS);
            try {
                mgr.sendGetAchInfo(nick, 0);
            } catch (e) {
                gzWarn('请求百胜战功数据失败', e);
                gzAchFinish(req, null);
            }
            return promise;
        }

        function gzAchEval(force) {
            if (!force && gzAch.evaluated) return gzAch.evaluated;
            var ev = gzAchEvaluate(gzAch.snapshot);
            if (ev) gzAch.evaluated = ev;
            return ev;
        }

        // 移植小抄 wQ：洗牌后取第一个
        function gzShufflePick(list) {
            var arr = (list || []).slice();
            for (var i = arr.length - 1; i > 0; i--) {
                var j = Math.floor(Math.random() * (i + 1));
                var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
            }
            return arr.length ? arr[0] : 0;
        }

        // 「技能战功是否完成」：小抄的百胜回包里，技能战功（flags 0x400 / 0x401 或固定 Id 0x4cd）
        // 的 finishTimes > 0 就视为该武将技能战功已完成。返回 {武将id: true}。
        function gzAchSkillCompleted(snapshot) {
            var done = {};
            if (!snapshot) return done;
            var all = gzAchArrayOf(gzZk());
            if (!all || !all.length) return done;
            for (var i = 0; i < all.length; i++) {
                var d = all[i];
                if (!d) continue;
                var aid = gzNum(d.Id, d.id);
                var isSkill = GZ_SKILL_ACH_FLAGS.indexOf(Number(d.flags)) >= 0 || aid === GZ_SKILL_ACH_ID;
                if (!isSkill) continue;
                var cid = gzNum(d.characterId, d.CharacterId);
                if (!(cid > 0)) continue;
                if (Number(snapshot.finishTimes[aid]) > 0) done[cid] = true;
            }
            return done;
        }

        // 按序点将：先技能战功已完成的、再百胜进度做的最多的（同组内并列按武将 id 稳定排序）。
        function gzPickOrdered(pool, ev) {
            var skillDone = gzAchSkillCompleted(gzAch.snapshot);
            var details = (ev && ev.details) || {};
            var arr = pool.slice();
            arr.sort(function (a, b) {
                var sa = skillDone[a] ? 1 : 0, sb = skillDone[b] ? 1 : 0;
                if (sa !== sb) return sb - sa;                                 // 技能战功完成的排前面
                var pa = Number(details[a] && details[a].progress) || 0;
                var pb = Number(details[b] && details[b].progress) || 0;
                if (pa !== pb) return pb - pa;                                 // 百胜进度多的排前面
                return a - b;
            });
            return arr.length ? arr[0] : 0;
        }

        // mode: 'random' 随机点将 / 'order' 按序点将。
        // excludeId：本轮刚打完、回包可能还没同步的武将，优先排除（池里只剩它时才留）。
        function gzPickUnfinished(excludeId, mode) {
            var ev = gzAchEval(false);
            if (!ev || !ev.unfinished.length) return 0;
            var pool = [];
            for (var i = 0; i < ev.unfinished.length; i++) {
                if (excludeId && ev.unfinished[i] === excludeId && ev.unfinished.length > 1) continue;
                pool.push(ev.unfinished[i]);
            }
            if (!pool.length) pool = ev.unfinished.slice();
            if (mode === GZ_DJ_MODE_ORDER) return gzPickOrdered(pool, ev);
            return gzShufflePick(pool);
        }

        function gzHandleAchReply(msg, chan) {
            var nick = gzAch.pending ? gzAch.pending.nickname : gzNickname();
            var snap = gzAchParse(msg, nick);
            if (!snap) {
                gzAch.diag.parseFail += 1;
                gzAch.diag.lastChan = chan;
                if (!gzAch.diag.sample) gzAch.diag.sample = gzDescribeObj(msg);
                return;
            }
            gzAch.snapshot = snap;
            gzAch.evaluated = null;
            gzAch.diag.replies += 1;
            gzAch.diag.lastChan = chan;
            if (gzAch.pending) gzAchFinish(gzAch.pending, snap);
        }

        gzOn('ClientDbsGetuserachinfoRep', function (msg) { gzHandleAchReply(msg, 'console'); });

        gzOn('GsClientAchievementProgressUpdate', function () {
            // 局内推的战功进度：先作废缓存，回房间后再重新查询确认
            gzAch.evaluated = null;
        });

        /* ==================== 点将（移植小抄 pM / wC / wF） ==================== */
        function gzDianjiangContext(sc) {
            var view = sc && sc.dianjiangView;
            var mgr = view && view.manger;      // 小抄里就是这个拼写
            if (!view || !mgr) return null;
            if (typeof view.onOpenDJClick !== 'function') return null;
            if (typeof mgr.clearFigureState !== 'function') return null;
            if (typeof mgr.updateAllFigureState !== 'function') return null;
            if (typeof mgr.getfigureState !== 'function') return null;
            return { view: view, mgr: mgr };
        }

        function gzDianjiangSlot(mgr, slot) {
            try { return gzNum(mgr.getfigureState(slot)); } catch (e) { return 0; }
        }

        // 槽位序号 → 身份名（点将槽 = 身份序号：0 主公 / 1 忠臣 / 2 反贼 / 3 内奸）
        function gzSlotName(slot) {
            var names = ['主公', '忠臣', '反贼', '内奸'];
            var s = Number(slot);
            return names[s] || ('身份槽' + s);
        }

        // 移植小抄 wC / JN：把目标武将写进目标身份的点将槽，并校验本地状态
        function gzDianjiangWrite(mgr, generalId, slot, tapFigure) {
            var id = Number(generalId) || 0;
            var s = Number(slot) || 0;
            try {
                mgr.allSame = 0;
                mgr.figureId = s;
                mgr.clearFigureState();
                // 这个事件是给「已经打开的点将面板」翻页用的；面板没开就不发，免得把界面唤出来
                if (tapFigure && typeof mgr.event === 'function') mgr.event('DJ_TAP_FIGURE_CHANGE', s);
                if (id > 0) mgr.updateAllFigureState(id);
                var states = [];
                for (var i = 0; i < 4; i++) states.push(gzNum(mgr.getfigureState(i)));
                if (id <= 0) {
                    for (var a = 0; a < states.length; a++) if (states[a] > 0) return false;
                    return true;
                }
                if (states[s] !== id) return false;
                for (var b = 0; b < states.length; b++) {
                    if (b !== s && states[b] > 0) return false;
                }
                return true;
            } catch (e) {
                gzWarn('写点将槽失败', e);
                return false;
            }
        }

        // 小抄 Jh 写完槽后的两项校验：配置里还有非法点将 / 当前账号能不能点将
        function gzDianjiangIllegal(mgr) {
            try {
                return (typeof mgr.HasIllegalDianjiang === 'function') ? !!mgr.HasIllegalDianjiang() : false;
            } catch (e) { return false; }
        }

        function gzDianjiangCan(mgr) {
            try {
                return (typeof mgr.canDianJiang === 'function') ? !!mgr.canDianJiang() : true;
            } catch (e) { return true; }
        }

        // 小抄 Jh 写槽后必做的两件事：选中该武将 + 把点将配置落盘
        function gzDianjiangSelectAndSave(mgr, id) {
            try {
                if (typeof mgr.event === 'function') mgr.event('DJ_SELECT_GENERAL', { ItemID: id, Id: id });
            } catch (e) { gzWarn('触发 DJ_SELECT_GENERAL 失败', e); }
            try {
                if (typeof mgr.saveFigureConfiger === 'function') mgr.saveFigureConfiger();
            } catch (e) { gzWarn('保存点将配置失败', e); }
        }

        // 把点将面板切到目标身份那一页：面板身份页 = figureId + DJ_TAP_FIGURE_CHANGE
        function gzDianjiangSwitchIdentity(mgr, slot) {
            if (!mgr) return false;
            var s = Number(slot) || 0;
            try {
                mgr.allSame = 0;
                mgr.figureId = s;
                if (typeof mgr.event === 'function') mgr.event('DJ_TAP_FIGURE_CHANGE', s);
                return true;
            } catch (e) { return false; }
        }

        // 移植小抄 wq：点将回包是否就是我们要的那名武将（Figure 是 1 基的身份值：主公=1 / 反贼=3）
        function gzDianjiangPayloadMatch(payload, generalId, nickname, slot) {
            if (!payload) return false;
            var b = payload.ProtoObj || payload.protoObj || payload;
            var nick = gzTrim(gzPickField(b, ['SzNickName', 'szNickname']) || '');
            if (nick && nickname && nick !== nickname) return false;
            var list = gzPickField(b, ['List', 'list', 'data']);
            if (Object.prototype.toString.call(list) !== '[object Array]') return false;
            for (var i = 0; i < list.length; i++) {
                var row = list[i] || {};
                var gid = gzNum(row.GeneralID, row.generalID, row.generalId);
                var fig = gzNum(row.Figure, row.figure);
                if (gid === Number(generalId) && fig === Number(slot) + 1) return true;
            }
            return false;
        }

        // 找「现成的点将窗口」：DianJiangWindow，或舞台里任何带 sendDianJiang 的节点（隐藏的也算）
        function gzScanDjWindow() {
            var L = GAME.laya();
            if (!L || !L.stage) return null;
            var queue = [L.stage], guard = 0;
            while (queue.length && guard < 3000) {
                guard += 1;
                var n = queue.shift();
                var kids = [];
                try { kids = n._children || []; } catch (e) { kids = []; }
                for (var i = 0; i < kids.length; i++) {
                    var c = kids[i];
                    if (!c) continue;
                    if (typeof c.sendDianJiang === 'function') return c;
                    queue.push(c);
                }
            }
            return null;
        }

        function gzFindDjWindow() {
            // 只认「还挂在显示列表上」的窗口（小抄 JE() 就是这个判断）。
            // Remove 之后窗口对象往往还在 WindowManager 里，只是 parent 没了——
            // 那种已经关掉的窗口不能再拿来 sendDianJiang，否则请求发不出去（第二次之后全失败）。
            var w = null;
            try { w = GAME.win('DianJiangWindow'); } catch (e) { w = null; }
            if (w && !w.destroyed && w.parent && typeof w.sendDianJiang === 'function') return w;
            return gzScanDjWindow();
        }

        function gzCloseDjWindow(win) {
            if (!win) return;
            try { if (typeof win.Remove === 'function') win.Remove(true); } catch (e) {}
            try { if (typeof win.removeSelf === 'function' && win.parent) win.removeSelf(); } catch (e) {}
            try { win.visible = false; } catch (e) {}
        }

        // 点将相关界面的可见性快照 / 把「为了发送临时弹出来的」界面再藏回去
        function gzDjScanSurfaces() {
            var out = [], L = GAME.laya(), root = L && L.stage;
            if (root) {
                var queue = [root], guard = 0;
                while (queue.length && guard < 4000) {
                    guard += 1;
                    var n = queue.shift();
                    var nm = '';
                    try { nm = String((n && n.name) || (n && n.constructor && n.constructor.name) || ''); } catch (e) { nm = ''; }
                    var isDJ = /DianJiang/i.test(nm);
                    if (!isDJ) { try { if (typeof n.sendDianJiang === 'function') isDJ = true; } catch (e) {} }
                    if (isDJ) {
                        var vis = true;
                        try { vis = n.visible !== false; } catch (e) { vis = true; }
                        out.push({ node: n, visible: vis });
                    }
                    var kids = [];
                    try { kids = n._children || []; } catch (e) { kids = []; }
                    for (var i = 0; i < kids.length; i++) if (kids[i]) queue.push(kids[i]);
                }
            }
            try {
                var sc = GAME.scene();
                if (sc && sc.dianjiangView) {
                    var found = false;
                    for (var j = 0; j < out.length; j++) if (out[j].node === sc.dianjiangView) { found = true; break; }
                    if (!found) out.push({ node: sc.dianjiangView, visible: sc.dianjiangView.visible !== false });
                }
            } catch (e) {}
            return out;
        }

        function gzDjHideSurfaces(before) {
            var after = gzDjScanSurfaces();
            for (var i = 0; i < after.length; i++) {
                var n = after[i].node, was = null;
                for (var j = 0; j < (before || []).length; j++) {
                    if (before[j].node === n) { was = before[j].visible; break; }
                }
                if (was === null || (was === false && after[i].visible)) {
                    try { n.visible = false; } catch (e) {}
                }
            }
        }

        // 在点将面板里「按卡片」把目标武将置入目标身份页（强制置入）。
        // 没开启/要解锁的武将，游戏会在点它的时候自己弹解锁/自动打开。
        function gzClickTargetCard(mgr, wantId, wantName, slot) {
            var panels = gzDianjiangPanels(GAME.scene());
            for (var i = 0; i < panels.length; i++) {
                var panel = panels[i];
                if (!panel || panel.destroyed || !panel.generalUis || !panel.generalUis.length) continue;
                gzDianjiangSwitchIdentity(mgr, slot);       // 先切到目标身份页
                var card = gzPickGeneralCard(panel, wantId, wantName);
                if (!card) continue;
                if (gzClickGeneralCard(panel, card)) {
                    gzLog('点将面板：点了「' + (card.name || wantName || wantId) + '」的卡片（' +
                        (gzNodeName(panel) || 'dianjiangView') + '）');
                    return true;
                }
            }
            return false;
        }

        // 强制置入 + 发送：开面板 → 切页点卡 → 发送 → 关掉。
        // 之所以要真去点卡片：光写槽 + sendDianJiang 在有些情况下不会生效
        //（没开启/要解锁的武将、面板状态要对齐等）。
        function gzDianjiangSend(ctx, generalId, slot, isAlive) {
            var mgr = ctx.mgr, view = ctx.view;
            var evt = 'UPDATE_OTHER_DJ';
            try { evt = (mgr.constructor && mgr.constructor.UPDATE_OTHER_DJ) || evt; } catch (e) {}
            if (typeof mgr.on !== 'function' || typeof mgr.off !== 'function') return Promise.resolve(false);
            var nick = gzNickname();
            var gname = gzGeneralNameById(generalId);
            var confirmed = false;
            function onPayload(payload) {
                if (gzDianjiangPayloadMatch(payload, generalId, nick, slot)) confirmed = true;
            }
            try { mgr.on(evt, mgr, onPayload); } catch (e) { return Promise.resolve(false); }

            var before = gzDjScanSurfaces();
            var hadWindow = !!gzFindDjWindow();
            if (hadWindow) {
                gzLog('点将发送：面板已经开着，直接切页点「' + gname + '」的卡片');
            } else {
                gzLog('点将发送：打开点将面板，强制点「' + gname + '」的卡片');
                try { if (view && typeof view.onOpenDJClick === 'function') view.onOpenDJClick(); }
                catch (e) { gzWarn('打开点将界面失败', e); }
            }

            function sendNow() {
                // ① 先点卡片（最多约 2s，每 150ms 试一次）
                var clicked = false;
                return gzWaitFor(function () {
                    if (!clicked && gzClickTargetCard(mgr, generalId, gname, slot)) { clicked = true; return 1; }
                    return clicked ? 1 : null;
                }, 14, 150, isAlive).then(function (hit) {
                    if (!hit) {
                        gzWarn('点将面板：没找到「' + gname + '」的卡片，改成直接发送本地配置');
                        return;
                    }
                    // ② 没开启/要解锁的武将，点完卡片游戏会弹「解锁/使用点将卡」确认框，弹了就点确定
                    return gzWaitFor(function () {
                        try {
                            if (gzClickConfirmLabel(['确定', '确认', '是', '使用', '解锁', '开启'])) {
                                gzLog('点将面板：点了「解锁/使用」确认框');
                                return 1;
                            }
                        } catch (e) {}
                        return null;
                    }, 8, 150, isAlive);
                });
            }

            function pressSend() {
                var win = gzFindDjWindow();
                if (win && typeof win.sendDianJiang === 'function') {
                    gzLog('点将发送：sendDianJiang()');
                    try { win.sendDianJiang(); } catch (e) { gzWarn('发送点将请求失败', e); }
                    gzCloseDjWindow(win);
                    return Promise.resolve(true);
                }
                // 面板可能刚创建还没登记：再等一会儿
                return gzWaitFor(function () {
                    var w = gzFindDjWindow();
                    if (w && typeof w.sendDianJiang === 'function') {
                        gzLog('点将发送：sendDianJiang()（等到的窗口）');
                        try { w.sendDianJiang(); } catch (e) { gzWarn('发送点将请求失败', e); }
                        gzCloseDjWindow(w);
                        return 1;
                    }
                    return null;
                }, 20, 100, isAlive).then(function (v) {
                    if (!v) gzWarn('点将发送：一直没找到点将窗口（sendDianJiang 用不了），这次没发出去');
                    return !!v;
                });
            }

            return Promise.resolve()
                .then(sendNow)
                .then(pressSend)
                .catch(function (e) { gzWarn('发送点将请求异常', e); return false; })
                .then(function (sent) {
                    gzDjHideSurfaces(before);
                    if (!sent) {
                        // 实在发不出去：本地配置已经写好了，按本地槽位算成功（提示可能要下一把才生效）
                        try { mgr.off(evt, mgr, onPayload); } catch (e) {}
                        var okLocal = gzDianjiangSlot(mgr, slot) === Number(generalId);
                        if (okLocal) gzLog('点将只写入了本地配置（没发送成功，可能要下一把才生效）');
                        return okLocal;
                    }
                    // 开面板可能重载过配置：把本地槽位和落盘再确认一遍
                    try { gzDianjiangWrite(mgr, generalId, slot, false); } catch (e) {}
                    try { if (typeof mgr.saveFigureConfiger === 'function') mgr.saveFigureConfiger(); } catch (e) {}
                    // 等服务器确认（最多 1.5s）；拿不到回包也认为发送成功
                    return gzWaitFor(function () { return confirmed ? 1 : null; }, 15, 100, isAlive)
                        .then(function () {
                            try { mgr.off(evt, mgr, onPayload); } catch (e) {}
                            var ok = gzDianjiangSlot(mgr, slot) === Number(generalId);
                            gzLog(confirmed ? ('服务器已确认点将：' + gzGeneralNameById(generalId))
                                : '点将已发送（没等到服务器回包）');
                            return ok;
                        });
                });
        }

        // 点将一整轮：打开界面 → 写槽（含小抄 Jh 的校验/选中/落盘）→ 发送并等确认
        function gzDianjiangSelect(sc, generalId, slot, isAlive) {
            var id = Number(generalId) || 0;
            if (!(id > 0)) return Promise.resolve(false);
            var ctx = gzDianjiangContext(sc);
            if (!ctx) {
                return gzWaitFor(function () { return gzDianjiangContext(GAME.scene()); }, 30, 200, isAlive)
                    .then(function (c) {
                        if (!c) return false;
                        return gzDianjiangRun(c, id, slot, isAlive);
                    });
            }
            return gzDianjiangRun(ctx, id, slot, isAlive);
        }

        function gzDianjiangRun(ctx, id, slot, isAlive) {
            var cur = gzDianjiangSlot(ctx.mgr, slot);
            gzLog('点将：目标「' + gzGeneralNameById(id) + '」(' + id + ')，' +
                gzSlotName(slot) + '槽现值 ' + cur + '（每局都重写）');
            // 每次开启功能 / 每开下一把都**无条件重写槽位**：点将窗口每次重开、每局重置
            // 都可能把槽位吃掉，只靠"槽位对得上就不动"会漏。
            // 写槽前不主动打开点将界面（面板本来就开着才发那个翻页事件）；
            // 发送交给 gzDianjiangSend —— 它会尽量用现成/隐藏的窗口，实在没有才临时开一次并立刻关掉。
            var panelOpen = !!gzFindDjWindow();
            if (!gzDianjiangWrite(ctx.mgr, id, slot, panelOpen)) {
                try { if (typeof ctx.mgr.cancelDianJiang === 'function') ctx.mgr.cancelDianJiang(); } catch (e) {}
                gzWarn('点将槽写入失败（武将 ' + id + '，' + gzSlotName(slot) + '槽 ' + slot + '）');
                return Promise.resolve(false);
            }
            // 小抄 Jh 遇到 HasIllegalDianjiang() 会跳过这名武将；但游戏其实允许直接点
            // （点将窗口会自己弹解锁/自动打开），所以这里只告警、不中止，照样发出去。
            if (gzDianjiangIllegal(ctx.mgr)) {
                gzLog('当前点将是非法配置（武将可能没开启/需要解锁），仍然发送，交给游戏自己处理');
            }
            if (!gzDianjiangCan(ctx.mgr)) {
                try { if (typeof ctx.mgr.cancelDianJiang === 'function') ctx.mgr.cancelDianJiang(); } catch (e) {}
                gzWarn('当前账号不能点将（canDianJiang=false），改走面板点卡兜底');
                return Promise.resolve(false);
            }
            gzDianjiangSelectAndSave(ctx.mgr, id);
            return gzDianjiangSend(ctx, id, slot, isAlive);
        }

        // 兜底：先把点将面板切回目标身份页，再按名字（有 ID 时也比 ID）点目标武将卡片
        function gzDianjiangPanelPick(sc, mgr, wantId, wantName, slot, isAlive) {
            return gzWaitFor(function () {
                if (isAlive && !isAlive()) return null;
                var panels = gzDianjiangPanels(sc);
                for (var i = 0; i < panels.length; i++) {
                    var panel = panels[i];
                    if (!panel || !panel.generalUis || !panel.generalUis.length) continue;
                    gzDianjiangSwitchIdentity(mgr || panel.manger, slot);
                    var card = gzPickGeneralCard(panel, wantId, wantName);
                    if (!card) continue;
                    if (gzClickGeneralCard(panel, card)) {
                        gzLog('点将面板「' + gzSlotName(slot) + '」页里点了' + (card.name || wantName || wantId) +
                            '卡片（' + (gzNodeName(panel) || 'dianjiangView') + '）');
                        return 1;
                    }
                }
                return null;
            }, GZ_DJ_PANEL_ATTEMPTS, GZ_DJ_PANEL_GAP_MS, isAlive);
        }

        // 确保某个身份的点将槽就是目标武将：写槽+发送优先，失败再切回该身份页点卡兜底
        function gzEnsureDianjiangGeneral(sc, generalId, generalName, slot, isAlive) {
            return gzDianjiangSelect(sc, generalId, slot, isAlive).then(function (ok) {
                if (ok) return true;
                if (isAlive && !isAlive()) return false;
                var ctx = gzDianjiangContext(GAME.scene());
                var mgr = ctx && ctx.mgr;
                if (!mgr) return false;
                gzLog('写槽/发送没成功，改为在点将面板「' + gzSlotName(slot) + '」页点' +
                    (generalName || ('武将#' + generalId)) + '卡片');
                return gzDianjiangPanelPick(sc, mgr, generalId, generalName, slot, isAlive)
                    .then(function (clicked) {
                        if (!clicked) return false;
                        if (!(generalId > 0)) return true;      // 没 ID 就没法校验，点了就算
                        return gzWaitFor(function () {
                            return (gzDianjiangSlot(mgr, slot) === Number(generalId)) ? 1 : null;
                        }, GZ_DJ_VERIFY_ATTEMPTS, GZ_DJ_VERIFY_GAP_MS, isAlive)
                            .then(function (v) { return !!v; });
                    });
            });
        }

        /* ==================== 选将（移植小抄 DR / DE） ==================== */
        // 收集所有「带 generalUis 的节点」。
        // 不依赖 WindowManager：直接从 Laya.stage 往下扫，拿 WindowManager 的结果兜底，
        // 这样即使 SceneManager/WindowManager 的启发式定位在某个客户端上失效，也还能认出选将界面。
        function gzCollectGeneralNodes(node, out, depth) {
            if (!node || depth > 8) return;
            var kids = [];
            try { kids = node._children || []; } catch (e) { return; }
            for (var i = 0; i < kids.length; i++) {
                var c = kids[i];
                if (!c) continue;
                try {
                    if (c.generalUis && c.generalUis.length && out.indexOf(c) < 0) out.push(c);
                } catch (e) {}
                gzCollectGeneralNodes(c, out, depth + 1);
            }
        }

        function gzGeneralWindows() {
            var out = [];
            var L = GAME.laya();
            if (L && L.stage) gzCollectGeneralNodes(L.stage, out, 0);
            var list = GAME.allWindows();
            for (var i = 0; i < list.length; i++) {
                var w = list[i].win;
                if (w && w.generalUis && w.generalUis.length && out.indexOf(w) < 0) out.push(w);
            }
            return out;
        }

        function gzNodeName(node) {
            try {
                return String((node && node.name) || (node && node.constructor && node.constructor.name) || '');
            } catch (e) { return ''; }
        }

        /* ---------- 按「界面上的文字」找节点并点击（不做像素定位） ---------- */
        function gzTextOf(node) {
            if (!node) return '';
            var t = '';
            try {
                if (typeof node.text === 'string') t = node.text;
                else if (typeof node.label === 'string') t = node.label;
                else if (node._text) t = (typeof node._text === 'string') ? node._text : (node._text.text || '');
                else if (node.txt && typeof node.txt.text === 'string') t = node.txt.text;
            } catch (e) { t = ''; }
            if (!t) {
                try { if (typeof node._innerHTML === 'string') t = node._innerHTML.replace(/<[^>]*>/g, ''); } catch (e) {}
            }
            return gzTrim(t);
        }

        function gzClickable(node) {
            try {
                return typeof node.onClick === 'function' ||
                    typeof node.onMouse === 'function' ||
                    typeof node.click === 'function';
            } catch (e) { return false; }
        }

        // 子节点：除了 _children，还把 Laya 窗口常见的 btnList / btns 等数组一起算上
        var GZ_CHILD_LISTS = ['btnList', 'btns', 'buttonArr', 'items', 'cells'];
        function gzChildNodes(node) {
            var out = [];
            try {
                var kids = node._children;
                if (kids && kids.length) {
                    for (var i = 0; i < kids.length; i++) if (kids[i]) out.push(kids[i]);
                }
            } catch (e) {}
            for (var j = 0; j < GZ_CHILD_LISTS.length; j++) {
                try {
                    var arr = node[GZ_CHILD_LISTS[j]];
                    if (arr && arr.length) {
                        for (var m = 0; m < arr.length; m++) {
                            if (arr[m] && out.indexOf(arr[m]) < 0) out.push(arr[m]);
                        }
                    }
                } catch (e) {}
            }
            return out;
        }

        // 遍历 Laya 节点树（有界）
        function gzWalkNodes(root, depth, fn) {
            if (!root || depth > 12) return false;
            var kids = gzChildNodes(root);
            for (var i = 0; i < kids.length; i++) {
                var c = kids[i];
                if (fn(c) === true) return true;
                if (gzWalkNodes(c, depth + 1, fn) === true) return true;
            }
            return false;
        }

        // 把一棵树里能看见的文字收集起来（排查用）
        function gzCollectTexts(root, out, limit, depth) {
            if (!root || (depth || 0) > 10 || out.length >= limit) return out;
            var kids = gzChildNodes(root);
            for (var i = 0; i < kids.length && out.length < limit; i++) {
                var t = gzTextOf(kids[i]);
                if (t && t.length <= 20 && out.indexOf(t) < 0) out.push(t);
                gzCollectTexts(kids[i], out, limit, (depth || 0) + 1);
            }
            return out;
        }



        // 在 root 子树里找「文字匹配且可点」的节点（自己不可点就往上看 3 层）
        function gzFindClickableText(root, re) {
            var found = null;
            gzWalkNodes(root, 0, function (node) {
                var t = gzTextOf(node);
                if (!t || !re.test(t)) return false;
                var n = node;
                for (var i = 0; i <= 3 && n; i++) {
                    if (gzClickable(n) && gzUsable(n)) { found = n; return true; }
                    n = n.parent;
                }
                return false;
            });
            return found;
        }

        // 只找文字（不看能不能点），返回命中的文字
        function gzFindText(root, re) {
            var found = '';
            gzWalkNodes(root, 0, function (node) {
                var t = gzTextOf(node);
                if (t && re.test(t)) { found = t; return true; }
                return false;
            });
            return found;
        }

        // 节点在舞台里的坐标（能给「点击空白处」这类提示点到它自己身上）
        function gzNodeGlobalPos(node) {
            try {
                var L = GAME.laya();
                if (L && L.Point && node && typeof node.localToGlobal === 'function') {
                    var p = node.localToGlobal(new L.Point(0, 0));
                    if (p) return { x: Number(p.x) || 0, y: Number(p.y) || 0 };
                }
            } catch (e) {}
            var x = 0, y = 0, n = node, guard = 0;
            while (n && guard++ < 40) {
                x += Number(n.x) || 0;
                y += Number(n.y) || 0;
                n = n.parent;
            }
            return { x: x, y: y };
        }


        function gzVisibleSelectWindow() {
            var nodes = gzGeneralWindows();
            var fallback = null;
            for (var i = 0; i < nodes.length; i++) {
                var win = nodes[i];
                if (!win || win.destroyed || win.visible === false) continue;
                var name = gzNodeName(win);
                if (GZ_SELECT_WINDOW_SKIP.indexOf(name) >= 0) continue;
                if (GZ_DIANJIANG_NAME_RE.test(name)) continue;
                if (!win.generalUis || !win.generalUis.length) continue;
                if (gzGeneralCards(win).length) {
                    if (GZ_SELECT_WINDOW_RE.test(name)) return win;
                    if (!fallback) fallback = win;
                }
            }
            return fallback;      // 类名对不上也认，避免认不出来就一直卡在选将
        }

        function gzGeneralCardInfo(win, ui) {
            var info = ui.generalInfo || ui.GeneralInfo || ui.vo || ui.Vo || ui.data || {};
            var id = gzNum(info.itemId, info.ItemID, info.itemID, info.generalId, info.GeneralID,
                info.generalid, ui.CardID, ui.cardId, ui.generalId, ui.GeneralID, ui.itemId, ui.ItemID);
            var name = gzTrim(info.itemName || info.ItemName || info.generalName || info.GeneralName ||
                info.CardName || info.name || info.Name ||
                ui.CardName || ui.generalName || ui.itemName || ui.name || '');
            if (!(id > 0) && name) id = gzGeneralIdByName(name);
            return { ui: ui, id: id, name: name };
        }

        function gzGeneralCards(win) {
            var out = [];
            var list = (win && win.generalUis) || [];
            for (var i = 0; i < list.length; i++) {
                var ui = list[i];
                if (!ui || ui.destroyed || ui.visible === false) continue;
                var card = gzGeneralCardInfo(win, ui);
                var selectable = typeof ui.sureBtnClick === 'function' ||
                    /Happy/.test(String(win.name || '')) || typeof win.SetMineSelectId === 'function';
                if (!selectable && !(card.id > 0) && !card.name) continue;
                out.push(card);
            }
            return out;
        }

        function gzPickGeneralCard(win, wantId, wantName) {
            var cards = gzGeneralCards(win);
            var i;
            for (i = 0; i < cards.length; i++) if (gzCardMatches(cards[i], wantId, wantName)) return cards[i];
            return null;
        }

        // 武将卡匹配：先比 ID，再比名字；名字比不过时用 generalDict 把 ID 翻成名字再比
        function gzCardMatches(card, wantId, wantName) {
            if (!card) return false;
            if (wantId > 0 && card.id === Number(wantId)) return true;
            if (!wantName) return false;
            if (card.name === wantName) return true;
            if (card.id > 0 && gzGeneralNameById(card.id) === wantName) return true;
            return false;
        }

        function gzCardDump(win) {
            var cards = gzGeneralCards(win);
            var out = [];
            for (var i = 0; i < cards.length; i++) {
                out.push((cards[i].name || '?') + '#' + cards[i].id);
            }
            return '窗口「' + gzNodeName(win) + '」候选：' + (out.join('、') || '(空)');
        }

        // 移植小抄 DR：有 SetMineSelectId 的（Happy 系）先写选择再点确定；其余直接 sureBtnClick()
        function gzClickGeneralCard(win, card) {
            if (!win || !card || !card.ui) return false;
            var ui = card.ui;
            var happyStyle = false;
            try { happyStyle = typeof win.SetMineSelectId === 'function'; } catch (e) { happyStyle = false; }
            if (happyStyle) {
                try { win.SetMineSelectId(card.id); } catch (e) { gzWarn('SetMineSelectId 失败', e); }
                if (gzClickHappySure(win)) return true;
            }
            try {
                if (typeof ui.sureBtnClick === 'function') {
                    ui.sureBtnClick();
                    setTimeout(function () {
                        try {
                            if (!win.destroyed && win.visible !== false &&
                                typeof ui.sureBtnClick === 'function') ui.sureBtnClick();
                        } catch (e) {}
                    }, 200);
                    return true;
                }
            } catch (e) {
                gzWarn('选择武将失败', e);
            }
            // 兜底：不同版本的武将卡可能只挂了 onClick / onMouse
            try { if (typeof ui.onClick === 'function') { ui.onClick(); return true; } } catch (e) {}
            if (GAME.click(ui)) return true;
            try {
                if (typeof win.sureBtnClick === 'function') { win.sureBtnClick(); return true; }
            } catch (e) {}
            if (gzClickHappySure(win)) return true;
            return false;
        }

        // 确定按钮：Happy 系在 SelfSeatUi.happySelectGeneralUI.sureBtn，其次窗口自己的确定按钮
        function gzClickHappySure(win) {
            try {
                var gs = GAME.gamescene();
                var self = gs && gs.SelfSeatUi;
                var happy = self && self.happySelectGeneralUI;
                var sure = happy && happy.sureBtn;
                if (sure && gzUsable(sure)) return GAME.pressButton(sure);
            } catch (e) {}
            try {
                var btn = win && (win.sureBtn || win.confirmBtn || win.sureBtnClick2);
                if (btn && gzUsable(btn)) return GAME.pressButton(btn);
            } catch (e) {}
            return false;
        }

        /* ==================== 角色运行状态 ==================== */
        var gzHost = {
            on: false, runId: 0, phase: '', djDone: false, djPending: false, aiDone: false,
            aiTries: 0, startTries: 0, startAt: 0, selectDone: false, selectFirstSeen: 0,
            selectGoneAt: 0, selectLogged: false,
            djOn: false, djOpenTried: 0, djOpenMiss: 0, djOpenAt: 0,
            roomLogged: false, gameLogged: false,
            kourouAt: 0, kourouCount: 0, cancelCount: 0, generalId: 0, selectWaitLog: 0,
            delayMode: false, waitStartAt: 0, delayDone: false, delayNoTimerLogged: false,
            trusteeOffAt: 0, trusteeOffTries: 0, trusteeOffWarned: false,
            stuckLogged: false, error: ''
        };

        var gzRebel = {
            on: false, runId: 0, phase: '', djMode: false, djPick: GZ_DJ_MODE_OFF, generalId: 0, generalName: '',
            djDone: false, djPending: false, readyClicked: false, trusteeDone: false, trusteeHoldLogged: false, cancelCount: 0,
            trusteeAt: 0, trusteeTries: 0, selectDone: false, selectFirstSeen: 0,
            selectGoneAt: 0, selectLogged: false,
            fallbackLogged: false, pendingAch: false, achBusy: false, achTries: 0, error: '',
            slotWaitAt: 0,
            boxAchAt: 0, boxAchLogged: false, boxPickLogged: false,   // 不点将：选将框按序挑人（等百胜数据 / 日志去重）
            trusteeHoldUntil: 0, mlRiskAt: 0,   // 手气卡守备：托管延后 / 开局整树扫描不降速
            trusteeOffAt: 0, trusteeOffTries: 0, trusteeOffWarned: false // 守备期间把上一局遗留的托管关掉
        };

        function gzAlive(role, runId) {
            return !!role.on && role.runId === runId;
        }

        function gzFailHost(reason) {
            if (!gzHost.on) return;
            gzHost.error = reason;
            gzHost.on = false;
            gzHost.runId += 1;
            gzWarn('盖主（小号）已停止：' + reason);
            showToast('盖主速刷（小号）已停止：' + reason, 'red', 6000);
            gzSyncSwitch(GZ_SW_HOST, false);
            gzRefreshUi();
        }

        function gzFailRebel(reason) {
            if (!gzRebel.on) return;
            gzRebel.error = reason;
            gzRebel.on = false;
            gzRebel.runId += 1;
            gzWarn('反贼（大号）已停止：' + reason);
            showToast('盖主速刷（反贼/大号）已停止：' + reason, 'red', 6000);
            gzSyncSwitch(GZ_SW_REBEL, false);
            gzRefreshUi();
        }

        /* ==================== 房间内的通用动作 ==================== */
        function gzSeatList(sc) {
            try {
                var list = sc && sc.seatListView && sc.seatListView.seatList;
                return list || null;
            } catch (e) { return null; }
        }

        function gzWaitInfo(seat) {
            return (seat && (seat.waitInfo || seat.WaitInfo)) || null;
        }

        function gzMySeat(sc) {
            var list = gzSeatList(sc);
            if (!list) return null;
            var myId = gzMyUserId();
            if (!(myId > 0)) return null;
            for (var i = 0; i < list.length; i++) {
                var info = gzWaitInfo(list[i]);
                if (info && gzNum(info.clientId) === myId) return list[i];
            }
            return null;
        }

        function gzEmptySeats(sc) {
            var list = gzSeatList(sc);
            if (!list) return null;
            var out = [];
            for (var i = 0; i < list.length; i++) {
                if (!gzWaitInfo(list[i])) out.push(list[i]);
            }
            return out;
        }

        // 小抄 hv：在系统确认框里按按钮文本点按钮（默认标题「系统提示」）
        function gzClickConfirmLabel(labels) {
            var layer = GAME.klass('PromptLayer');
            var confirm = layer && layer.confirmWin;
            if (!confirm || !confirm.confirmData) return false;
            var arr = confirm.confirmData.buttonArr || [];
            var btn = null;
            var i, j;
            for (i = 0; i < labels.length && !btn; i++) {
                for (j = 0; j < arr.length; j++) {
                    if (gzTrim(arr[j] && arr[j].label) === labels[i]) { btn = arr[j]; break; }
                }
            }
            for (i = 0; i < labels.length && !btn; i++) {
                for (j = 0; j < arr.length; j++) {
                    if (gzTrim(arr[j] && arr[j].label).indexOf(labels[i]) >= 0) { btn = arr[j]; break; }
                }
            }
            if (!btn) return false;
            try {
                if (typeof confirm.checkBoxChange === 'function' && confirm.checkBox) {
                    try { confirm.checkBox.selected = true; confirm.checkBoxChange(); } catch (e) {}
                }
            } catch (e) {}
            try {
                if (typeof btn.callBack === 'function') {
                    btn.callBack.apply(btn.thisObject || confirm, btn.callBackParams || []);
                } else if (typeof btn.onClick === 'function') {
                    btn.onClick();
                } else {
                    return false;
                }
            } catch (e) {
                gzWarn('点击确认框按钮失败', e);
                return false;
            }
            try {
                if (confirm.confirmData && confirm.confirmData.clickClose &&
                    typeof confirm.RemoveFromParent === 'function') confirm.RemoveFromParent();
            } catch (e) {}
            return true;
        }

        // 盖主：一键添加「普通小杀」补满空位
        function gzHostFillAi(sc) {
            var empty = gzEmptySeats(sc);
            if (empty && !empty.length) { gzHost.aiDone = true; gzHost.aiTries = 0; return; }
            var now = Date.now();
            if (now - (gzHost.aiAt || 0) < 1200) return;
            gzHost.aiAt = now;
            // 上一次点出来的「小杀类型」选择框：这一步只负责点确定
            if (gzHost.aiConfirmPending) {
                gzHost.aiConfirmPending = false;
                if (gzClickConfirmLabel(GZ_AI_LABEL_PREFS)) gzLog('已选择普通小杀');
                else gzWarn('没找到小杀类型选择框，稍后重试');
                return;
            }
            gzHost.aiTries += 1;
            if (gzHost.aiTries > 12) {
                gzHost.aiDone = true;     // 补不满也继续尝试开局（可能玩家自己带够了人机）
                gzWarn('一键添加小杀未补满座位，继续尝试开局');
                return;
            }
            var btn = sc.addAiBtn;
            if (!btn || !gzUsable(btn)) { gzHost.aiDone = true; return; }
            GAME.pressButton(btn);
            gzHost.aiConfirmPending = true;
            gzLog('点击一键添加小杀（第 ' + gzHost.aiTries + ' 次）');
        }

        // 盖主：点将黄盖
        // 「开启点将」的三级定位：① addAiBtn 所在那排 ② 房间界面文字 ③ onOpenDJClick()
        function gzLocateOpenDianjiang(sc) {
            try {
                var anchor = sc && sc.addAiBtn;
                var box = anchor && anchor.parent;
                if (box) {
                    var hit1 = gzFindClickableText(box, GZ_OD_NAME_RE);
                    if (hit1) return { node: hit1, text: gzTextOf(hit1), route: '锚点(addAiBtn)同级' };
                }
            } catch (e) {}
            var hit2 = gzFindClickableText(sc, GZ_OD_NAME_RE);
            if (hit2) return { node: hit2, text: gzTextOf(hit2), route: '房间界面文字' };
            var hit3 = gzFindClickableText(sc, GZ_OD_ANY_RE);
            if (hit3) return { node: hit3, text: gzTextOf(hit3), route: '房间界面文字(放宽到「点将」)' };
            return null;
        }

        // 点将是不是开着：管理器的 HaveDianJiang 在有的版本是函数，有的版本是布尔属性。
        // （原版 1.6.47 里是按布尔属性用的：if (manager.HaveDianJiang) …，不能再只认函数。）
        function gzDianjiangOnFlag(mgr) {
            if (!mgr) return null;
            try {
                var h = mgr.HaveDianJiang;
                if (typeof h === 'function') return !!h.call(mgr);
                if (typeof h === 'boolean') return h;
            } catch (e) {}
            return null;
        }

        // 点将是不是已经开着：管理器 API 最可信，其次按钮文案变成「关闭点将」，最后看点将面板
        function gzDianjiangIsOn(sc) {
            var byApi = null;
            try {
                var mgr = sc && sc.dianjiangView && sc.dianjiangView.manger;
                byApi = gzDianjiangOnFlag(mgr);
            } catch (e) { byApi = null; }
            if (byApi === true) return true;
            // 管理器能明确回答「没开」时直接返回，省掉一次整树扫描（每拍都扫会拖慢响应）
            if (byApi === false) return false;
            try { if (gzFindText(sc, GZ_OD_ON_RE)) return true; } catch (e) {}
            try {
                var dv = sc && sc.dianjiangView;
                if (dv && dv.visible !== false && dv.generalUis && dv.generalUis.length) return true;
            } catch (e) {}
            return false;
        }

        // 「开启点将」这一步：和「点黄盖」解耦，不依赖小抄配置/武将ID。
        // 返回 true = 这一步不用再管了（已开着 / 试满 / 找不到按钮），可以继续后面的点将黄盖。
        function gzHostEnsureDianjiangOpen(sc) {
            if (gzHost.djOn) return true;
            if (gzDianjiangIsOn(sc)) {
                gzHost.djOn = true;
                gzLog('点将已经是开启状态，不再点「开启点将」' +
                    (gzHost.roomFlowAt ? ('（进房 ' + (Date.now() - gzHost.roomFlowAt) + 'ms）') : ''));
                return true;
            }
            // 第一次点不加等待（进房就该马上点）；只有点了还没反应，才隔 1.5 秒补一次，
            // 免得把这个开关式按钮连点两下又关掉
            if (gzHost.djOpenTried > 0 && Date.now() - (gzHost.djOpenAt || 0) < GZ_OD_GAP_MS) return false;
            gzHost.djOpenAt = Date.now();
            if (gzHost.djOpenTried >= GZ_OD_MAX_TRIES) {
                gzHost.djOn = true;
                gzWarn('「开启点将」点了 ' + GZ_OD_MAX_TRIES + ' 次仍未确认，先继续后面的流程');
                return true;
            }
            var target = gzLocateOpenDianjiang(sc);
            if (target) {
                gzHost.djOpenTried += 1;
                gzHost.djOpenMiss = 0;
                gzLog('点击「' + (target.text || '开启点将') + '」（第 ' + gzHost.djOpenTried +
                    ' 次，走' + target.route + '，自进房 ' +
                    (gzHost.roomFlowAt ? (Date.now() - gzHost.roomFlowAt) : 0) + 'ms）');
                GAME.pressButton(target.node);
                return false;                 // 下一拍再确认状态
            }
            gzHost.djOpenMiss += 1;
            if (gzHost.djOpenMiss === GZ_OD_MAX_MISS) {
                try {
                    if (sc.dianjiangView && typeof sc.dianjiangView.onOpenDJClick === 'function') {
                        sc.dianjiangView.onOpenDJClick();
                        gzLog('回退调用 dianjiangView.onOpenDJClick()');
                    }
                } catch (e) {}
            } else if (gzHost.djOpenMiss > GZ_OD_MAX_MISS) {
                gzHost.djOn = true;
                gzWarn('一直没找到「开启点将」按钮，先继续后面的流程');
                gzLog('房间界面文字：' + (gzCollectTexts(sc, [], 30, 0).join('、') || '(没读到)'));
                return true;
            }
            return false;
        }

        // 点将面板：scene.dianjiangView 或名字里带「点将/DianJiang」的窗口，里面直接点黄盖
        function gzDianjiangPanels(sc) {
            var out = [];
            try { if (sc && sc.dianjiangView) out.push(sc.dianjiangView); } catch (e) {}
            var list = GAME.allWindows();
            for (var i = 0; i < list.length; i++) {
                var w = list[i].win;
                if (!w || w.destroyed || w.visible === false) continue;
                if (GZ_DIANJIANG_NAME_RE.test(gzNodeName(w)) && out.indexOf(w) < 0) out.push(w);
            }
            return out;
        }

        // 房间里「点将」是否开着：先问管理器，问不到再走文本/面板兜底（同 gzDianjiangIsOn）
        function gzDianjiangEnabled(sc) {
            try {
                var mgr = sc && sc.dianjiangView && sc.dianjiangView.manger;
                var v = gzDianjiangOnFlag(mgr);
                if (v !== null) return v;
            } catch (e) {}
            try { return gzDianjiangIsOn(sc); } catch (e) { return false; }
        }

        // 房间点将配置里「反贼」槽当前写的是谁。
        // 0 = 确实没选；-1 = 现在还读不到（界面/管理器没就绪），别当成「没选」去覆写。
        function gzConfiguredRebelGeneral(sc) {
            var scene = null;
            try { scene = sc || GAME.scene(); } catch (e) { scene = null; }
            try {
                var ctx = gzDianjiangContext(scene);
                if (ctx) return gzDianjiangSlot(ctx.mgr, GZ_DJ_SLOT_REBEL);
            } catch (e) {}
            try {
                var panels = gzDianjiangPanels(scene);
                for (var i = 0; i < panels.length; i++) {
                    var mgr = panels[i] && panels[i].manger;
                    if (mgr && typeof mgr.getfigureState === 'function') {
                        return gzNum(mgr.getfigureState(GZ_DJ_SLOT_REBEL));
                    }
                }
            } catch (e) {}
            return -1;
        }

        // 点将槽里的武将能不能给反贼继续用：有值、不是黄盖、百胜没完成
        function gzSlotGeneralUsable(slotId, ev) {
            if (!(slotId > 0)) return false;
            if (gzIsRebelBannedGeneral(slotId)) return false;
            if (ev && ev.completed && ev.completed[slotId]) return false;
            return true;
        }

        // 随机点将：槽里已经选了武将、且这名武将还没刷完百胜 → 继续刷它，不换人。
        // 只有「没选武将 / 选的是黄盖 / 这个武将百胜已完成」才回去随机挑。
        function gzKeepConfiguredRebelGeneral(ev) {
            var sc = null;
            try { sc = GAME.scene(); } catch (e) { sc = null; }
            if (!sc) return 0;
            var id = gzConfiguredRebelGeneral(sc);
            if (id < 0) {
                gzLog('随机点将：暂时读不到点将槽，先不判定');
                return 0;
            }
            if (!(id > 0)) return 0;
            if (!gzSlotGeneralUsable(id, ev)) {
                gzLog('随机点将：点将槽里的「' + gzGeneralNameById(id) + '」' +
                    (gzIsRebelBannedGeneral(id) ? '是黄盖/界黄盖，反贼不能用' : '百胜已完成') +
                    '，改随机挑下一个');
                return 0;
            }
            gzLog('随机点将：点将槽已选「' + gzGeneralNameById(id) +
                '」（点将' + (gzDianjiangEnabled(sc) ? '已开启' : '未开启') +
                '），百胜未完成，继续用它（不切换）');
            return id;
        }

        // 盖主：把「主公」的点将槽弄成黄盖（写槽优先 → 切回主公页点卡兜底），
        // 失败不卡流程，最后靠开局选将兜底。
        function gzHostDianjiang(sc) {
            if (gzHost.djPending) return;
            var wantId = gzHost.generalId || gzGeneralIdByName(GZ_HOST_GENERAL);
            gzHost.djPending = true;
            gzHost.djSeq = (gzHost.djSeq || 0) + 1;
            var seq = gzHost.djSeq;
            var runId = gzHost.runId;
            var alive = function () { return seq === gzHost.djSeq && gzAlive(gzHost, runId); };
            if (wantId > 0) {
                gzLog('准备点将' + GZ_HOST_GENERAL + '（' + gzSlotName(GZ_DJ_SLOT_HOST) + '槽 ' +
                    GZ_DJ_SLOT_HOST + '）：武将ID ' + wantId);
            } else {
                // 房间点将只是保险：小抄本体本来就不做房间点将，只靠开局选将点黄盖。
                // 拿不到 ID 不能把整条流程卡死：照旧按名字点面板，再让开局选将来兜。
                gzWarn('拿不到「' + GZ_HOST_GENERAL + '」的武将ID（小抄配置没读到：window.Uc1cryZVg 里找不到带 generalDict 的对象），' +
                    '改为按名字在点将面板点卡。');
                showToast('拿不到黄盖的武将ID，改为按名字点将', 'yellow', 5000);
            }
            gzEnsureDianjiangGeneral(sc, wantId, GZ_HOST_GENERAL, GZ_DJ_SLOT_HOST, alive)
                .then(function (ok) {
                    if (seq !== gzHost.djSeq) return;   // 已经进入下一轮了，丢弃过期结果
                    gzHost.djPending = false;
                    if (!gzAlive(gzHost, runId)) return;
                    gzHost.djDone = true;
                    if (ok) {
                        if (wantId > 0) gzHost.generalId = wantId;
                        gzLog('点将' + GZ_HOST_GENERAL + '完成（' + gzSlotName(GZ_DJ_SLOT_HOST) + '槽，' +
                            (wantId > 0 ? ('ID ' + wantId) : '按名字') + '，自进房 ' +
                            (gzHost.roomFlowAt ? (Date.now() - gzHost.roomFlowAt) : 0) + 'ms）');
                    } else {
                        gzWarn('房间点将失败，改为只靠开局选将点黄盖');
                        showToast('房间点将黄盖失败，改为开局选将自动点黄盖', 'yellow', 5000);
                    }
                });
        }

        // 盖主：点开始
        function gzHostStart(sc) {
            var now = Date.now();
            var startBtn = sc.startUI && sc.startUI.startBtn;
            if (!startBtn) return;
            if (!gzUsable(startBtn)) return;
            if (now - (gzHost.startAt || 0) < 2000) return;
            gzHost.startAt = now;
            gzHost.startTries += 1;
            if (gzHost.startTries > GZ_START_RETRY_MAX) {
                gzFailHost('连续 ' + GZ_START_RETRY_MAX + ' 次开局失败（反贼可能还没准备）');
                return;
            }
            try {
                if (typeof startBtn.onClick === 'function') startBtn.onClick({ type: 'click' });
                else GAME.pressButton(startBtn);
                gzLog('点击开始（第 ' + gzHost.startTries + ' 次）');
            } catch (e) {
                gzWarn('点击开始失败', e);
            }
        }

        /* ==================== 局内动作 ==================== */
        function gzUseSkill(skillName) {
            var gs = GAME.gamescene();
            var self = gs && gs.SelfSeatUi;
            if (!self) return false;
            try {
                if (self.spellSelector && self.spellSelector.visible) return false;
            } catch (e) {}
            var items = self.skillItems || [];
            for (var i = 0; i < items.length; i++) {
                var it = items[i];
                if (!it || it.destroyed) continue;
                var skill = it.Skill || {};
                if (gzTrim(skill.Name) !== skillName) continue;
                if (it.Selected) return false;
                if (!it.activated) return false;
                if (it.visible === false) return false;
                GAME.click(it);
                return true;
            }
            return false;
        }

        /* ==================== 出牌倒计时（「等1分钟」用） ====================
         * 原版小抄的「出牌读秒」开关读的就是游戏弹窗上的计时条：
         *   GamePopUpWindow.countdownTimer.RemainValue  —— 剩余秒数（浮点）。
         * （原版取到实例后会顺手调 ShowCountdownTimer(1) 来挂自己的文字层；
         *   我们只读 RemainValue，不碰它的显示，避免改游戏表现。）
         * 拿不到实例时再按结构兜底：在对局场景里找带数字 RemainValue 的计时条。
         * ================================================================ */
        var gzCd = { obj: null, at: 0, missLogged: false };

        // 直接问 Laya 要实例（绕开 GAME.getInstance 的永久缓存：对局重开后旧实例可能已经销毁）
        function gzPopupInstance() {
            try {
                var L = GAME.laya();
                if (L && L.ClassUtils && typeof L.ClassUtils.getInstance === 'function') {
                    var o = L.ClassUtils.getInstance('GamePopUpWindow', undefined);
                    if (o) return o;
                }
            } catch (e) {}
            try { return GAME.getInstance('GamePopUpWindow'); } catch (e) { return null; }
        }

        function gzCountdownNode() {
            var now = Date.now();
            if (gzCd.obj && !gzCd.obj.destroyed && now - gzCd.at < GZ_CD_CACHE_MS) return gzCd.obj;
            gzCd.at = now;
            var obj = null;
            try {
                var popup = gzPopupInstance();
                if (popup && !popup.destroyed) obj = popup.countdownTimer || null;
                if (obj && obj.destroyed) obj = null;
            } catch (e) { obj = null; }
            if (!obj) obj = gzScanCountdownNode();
            gzCd.obj = obj || null;
            return gzCd.obj;
        }

        function gzScanCountdownNode() {
            try {
                var root = GAME.gamescene();
                if (!root) return null;
                var queue = [root], guard = 0, loose = null;
                while (queue.length && guard < 4000) {
                    guard += 1;
                    var n = queue.shift();
                    if (!n || typeof n !== 'object') continue;
                    var v = n.RemainValue;
                    if (typeof v === 'number' && isFinite(v)) {
                        if (v > 0) return n;        // 优先正在走的计时条
                        if (!loose) loose = n;      // 全停着时也给一个，别每拍重扫
                    }
                    var kids = null;
                    try { kids = n._children; } catch (e) { kids = null; }
                    if (kids && kids.length) {
                        for (var i = 0; i < kids.length; i++) if (kids[i]) queue.push(kids[i]);
                    }
                }
                return loose;
            } catch (e) { return null; }
        }

        // 剩余秒数；读不到返回 null
        function gzCountdownRemain() {
            var node = gzCountdownNode();
            if (!node) return null;
            var v = node.RemainValue;
            if (v === undefined || v === null) v = node.remainValue;
            var n = Number(v);
            if (!isFinite(n) || n < 0) return null;
            return n;
        }

        // 「等1分钟」：返回 true = 这一刻继续烧条，先别点苦肉
        function gzHostBurningBar(now) {
            if (!gzHost.delayMode || gzHost.delayDone) return false;
            var remain = gzCountdownRemain();
            if (remain === null) {
                // 读不到就先不延迟（别把苦肉卡死），下一拍再试；同一局只告警一次
                if (!gzHost.delayNoTimerLogged) {
                    gzHost.delayNoTimerLogged = true;
                    gzWarn('「等1分钟」读不到出牌倒计时（GamePopUpWindow.countdownTimer.RemainValue），暂时不延迟，直接苦肉');
                }
                return false;
            }
            if (!gzHost.waitStartAt) {
                // 只在计时条真的开始走（>0）时才启动 45 秒窗口；选将/加载阶段的 0 不算
                if (!(remain > 0)) return false;
                gzHost.waitStartAt = now;
                gzLog('「等1分钟」：开始烧条，倒计时剩 ' + remain.toFixed(1) + ' 秒（到剩 ' +
                    GZ_WAIT_LEFT_SEC + ' 秒再苦肉，本局满 ' + Math.round(GZ_WAIT_DELAY_MS / 1000) + ' 秒后取消延迟）');
            }
            if (now - gzHost.waitStartAt >= GZ_WAIT_DELAY_MS) {
                gzHost.delayDone = true;
                gzLog('「等1分钟」：本局已过 ' + Math.round((now - gzHost.waitStartAt) / 1000) +
                    ' 秒，取消延迟，立刻苦肉收尾');
                return false;
            }
            return remain > GZ_WAIT_LEFT_SEC;
        }

        /* ==================== 手气卡弹窗：立刻点「取消」 ====================
         * 手气卡不是按钮栏提示，而是独立弹窗 ShouQiKaAskWindow（实机控制台可看到
         * 「打开弹窗ShouQiKaAskWindow」），所以：
         *   ① 按窗口名找到弹窗（WindowManager + 整棵 Laya 树兜底）；
         *   ② 弹窗里先按文案认「取消 / 不使用 / …」，认不出就点第二个按钮（小抄本体的思路）；
         *   ③ 没弹窗时再按关键词（提示正文 / 局内界面文字 / 窗口文字）找取消按钮。
         * 只点拒绝项，绝不点「更换手牌」。
         * ================================================================= */
        var gzMl = {
            clicks: 0, lastKey: '', sameCount: 0, lastClickAt: 0, diag: false, lastRoot: null,
            lastDeepWin: 0, lastDeepText: 0, busy: false, noticeAt: 0, noticeText: '',
            winLogged: false, missLogged: false, seenAt: 0, postSelectAt: 0
        };

        // 控制台即时线索：游戏自己会打印「打开弹窗ShouQiKaAskWindow」。
        // 记下时间戳，让手气卡处理在接下来几秒别被 800ms 限速挡住，并立刻尝试一次。
        var GZ_ML_HINT_RE = /ShouQiKa|手气卡/i;
        var GZ_ML_HOT_MS = 5000;

        function gzMlHot() {
            return (Date.now() - (gzMl.noticeAt || 0)) < GZ_ML_HOT_MS;
        }

        // 手气卡风险窗口：开局头 20 秒 / 刚收到提示的 5 秒内，整树扫描不降速
        function gzMlRisk() {
            if (gzMlHot()) return true;
            var now = Date.now();
            try {
                if (gzHost.on && gzHost.phase === 'game' && gzHost.gameEnteredAt &&
                    now - gzHost.gameEnteredAt < GZ_ML_RISK_MS) return true;
                if (gzRebel.on && gzRebel.phase === 'game' && gzRebel.mlRiskAt &&
                    now - gzRebel.mlRiskAt < GZ_ML_RISK_MS) return true;
            } catch (e) {}
            return false;
        }

        // 顺延反贼的托管守备（手气卡可能还没处理完）
        function gzMlExtendGuard(ms) {
            try {
                if (!gzRebel.on) return;
                var until = Date.now() + (Number(ms) > 0 ? Number(ms) : GZ_ML_TRUSTEE_GUARD_MS);
                gzRebel.trusteeHoldUntil = Math.max(Number(gzRebel.trusteeHoldUntil) || 0, until);
            } catch (e) {}
        }

        // 看到/收到手气卡线索：续热区，并把反贼的托管守备顺延
        function gzMlTouch() {
            var now = Date.now();
            gzMl.noticeAt = now;
            gzMl.seenAt = now;
            gzMlExtendGuard(GZ_ML_TRUSTEE_GUARD_MS);
        }

        // 现在是不是「手气卡可能还没处理完」：托管必须等
        function gzMlGuarded() {
            var now = Date.now();
            if (gzMlHot()) return true;
            try {
                if ((Number(gzRebel.trusteeHoldUntil) || 0) > now) return true;
                // 盖主（小号）开局头 20 秒同样算守备期：如果它也被开了托管，一样会把卡用掉
                if (gzHost.on && gzHost.phase === 'game' && gzHost.gameEnteredAt &&
                    now - gzHost.gameEnteredAt < GZ_ML_TRUSTEE_GUARD_MS) return true;
            } catch (e) {}
            if (gzMl.seenAt && now - gzMl.seenAt < GZ_ML_TRUSTEE_SEEN_MS) return true;
            if (gzMl.postSelectAt && now - gzMl.postSelectAt < GZ_ML_POST_SELECT_GUARD_MS) return true;
            return false;
        }

        // 线索出现 1.5s 还没找到弹窗/提示 → 打一条一次性告警，方便排查（窗口名/结构变了？）
        function gzMlNoteMiss(why) {
            if (gzMl.missLogged || !gzMlHot()) return;
            if (Date.now() - (gzMl.noticeAt || 0) < 1500) return;
            gzMl.missLogged = true;
            gzWarn('手气卡线索「' + (gzMl.noticeText || '?') + '」已出现 1.5s，但' + why);
        }

        // 只管「盖主速刷」自己的手气卡：盖主（小号）或反贼（大号）开着才动手。
        // 两个开关都关着时（用户自己正常玩 / 别的玩法）一律不碰，免得把手气卡给自动取消了。
        function gzMlActive() {
            try { return !!(gzHost.on || gzRebel.on); } catch (e) { return false; }
        }

        function gzMlNotice(text) {
            if (!gzMlActive()) return;                      // 盖主速刷没在跑 → 这条线索直接忽略
            var now = Date.now();
            if (now - (gzMl.noticeAt || 0) < 150) return;   // 合并同一拍连打的重复日志
            gzMl.noticeText = String(text || '').slice(0, 140);
            gzMl.diag = false;
            gzMl.lastKey = '';
            gzMl.sameCount = 0;
            gzMl.winLogged = false;
            gzMl.missLogged = false;
            gzMlTouch();
            gzLog('手气卡即时线索：' + gzMl.noticeText);
            try { gzTryCloseMulligan(); } catch (e) { gzWarn('手气卡即时处理失败', e); }
        }

        // 游戏如果用带 className 的 console 对象通知窗口，这条能比字符串日志更早触发
        gzOn('ShouQiKaAskWindow', function () {
            try { gzMlNotice('窗口消息 ShouQiKaAskWindow'); } catch (e) {}
        });

        function gzMlLabel(b) {
            if (!b) return '';
            var t = '';
            try { t = gzTrim(b.label || b.text || b.title || ''); } catch (e) { t = ''; }
            if (!t) t = gzTextOf(b);
            return t;
        }

        // 这个按钮看起来像「使用 / 更换手气卡」吗？
        // 「不使用 / 取消」这类先按拒绝算（GZ_ML_DECLINE_RE 命中就不算「使用」）。
        function gzMlLooksUse(label) {
            var t = gzTrim(label);
            if (!t) return false;
            if (GZ_ML_DECLINE_RE.test(t)) return false;
            return GZ_ML_USE_RE.test(t);
        }

        // 手气卡弹窗：具名窗口 + WindowManager 名字匹配 + 整棵 Laya 树名字匹配
        function gzMlWindows() {
            var out = [];
            var i, w;
            for (i = 0; i < GZ_ML_WINDOW_NAMES.length; i++) {
                try { w = GAME.win(GZ_ML_WINDOW_NAMES[i]); } catch (e) { w = null; }
                if (w && out.indexOf(w) < 0) out.push(w);
            }
            var list = GAME.allWindows();
            for (i = 0; i < list.length; i++) {
                w = list[i].win;
                if (!w || out.indexOf(w) >= 0) continue;
                if (GZ_ML_WINDOW_RE.test(String(list[i].name || '') + ' ' + gzNodeName(w))) out.push(w);
            }
            // 整棵舞台树找弹窗比较重，平时最多每 800ms 扫一次；
            // 手气卡风险窗口（开局头 20 秒 / 刚收到提示）里每拍都扫，尽量第一时间认出来
            if (!out.length && (gzMlRisk() || Date.now() - (gzMl.lastDeepWin || 0) > 800)) {
                gzMl.lastDeepWin = Date.now();
                try {
                    var L = GAME.laya();
                    if (L && L.stage) {
                        gzWalkNodes(L.stage, 0, function (node) {
                            var nm = '';
                            try { nm = String(node.name || (node.constructor && node.constructor.name) || ''); } catch (e) {}
                            if (nm && GZ_ML_WINDOW_RE.test(nm) && out.indexOf(node) < 0) out.push(node);
                            return false;
                        });
                    }
                } catch (e) {}
            }
            return out;
        }

        // 子树里按文案找拒绝按钮：先精确匹配，再包含匹配；exactOnly 时只做精确匹配
        function gzMlFindDeclineIn(root, route, exactOnly) {
            if (!root) return null;
            var passes = exactOnly ? 1 : 2;
            for (var pass = 0; pass < passes; pass++) {
                var found = null;
                gzWalkNodes(root, 0, function (node) {
                    var t = gzTextOf(node);
                    if (!t) return false;
                    var hit = false;
                    for (var i = 0; i < GZ_ML_DECLINE_LABELS.length; i++) {
                        if (pass === 0 ? (t === GZ_ML_DECLINE_LABELS[i])
                            : (t.indexOf(GZ_ML_DECLINE_LABELS[i]) >= 0)) { hit = true; break; }
                    }
                    if (!hit) return false;
                    var n = node;
                    for (var k = 0; k <= 3 && n; k++) {
                        if (gzClickable(n) && gzUsable(n)) {
                            found = { node: n, label: t, route: route };
                            return true;
                        }
                        n = n.parent;
                    }
                    return false;
                });
                if (found) return found;
            }
            return null;
        }

        // 认不出「取消」文案时的兜底：**只在能正向认出「使用/更换手气卡」按钮**的前提下，
        // 点它对面那个（才是拒绝）。认不出就返回 null。
        //
        // 老逻辑是「正好两个按钮就点第二个」——手气卡弹窗里第二个很可能就是「使用/更换手牌」，
        // 弹窗刚出现、按钮文字还没渲染出来的那一拍就会误点（实测约 15% 的手气卡误用来源）。
        // 现在宁可不点（等文字渲染出来下一拍再认），也绝不赌第二个按钮。
        function gzMlOtherOfUse(buttons, route) {
            if (!buttons || buttons.length !== 2) return null;
            var useIdx = -1;
            for (var i = 0; i < buttons.length; i++) {
                if (gzMlLooksUse(buttons[i].label)) { useIdx = i; break; }
            }
            if (useIdx < 0) return null;                       // 认不出「使用」是谁 → 不赌
            var other = buttons[1 - useIdx];
            if (gzMlLooksUse(other.label)) return null;        // 两个都像「使用」→ 也不赌
            return { node: other.node, label: other.label, route: route };
        }

        function gzMlOtherOfUseIn(root, route) {
            if (!root) return null;
            var buttons = [];
            gzWalkNodes(root, 0, function (node) {
                if (buttons.length >= 12) return true;
                if (!node || !gzUsable(node) || !gzClickable(node)) return false;
                var t = gzTextOf(node);
                if (!t || t.length > 8) return false;
                buttons.push({ node: node, label: t });
                return false;
            });
            return gzMlOtherOfUse(buttons, route);
        }

        // 弹窗诊断：把弹窗里的文字和可点按钮打出来
        function gzMlDumpWindow(win) {
            try {
                var texts = gzCollectTexts(win, [], 30, 0);
                gzWarn('手气卡弹窗「' + (gzNodeName(win) || '?') + '」文字：' + (texts.join('、') || '(没读到)'));
            } catch (e) {}
            try {
                var btns = [];
                gzWalkNodes(win, 0, function (node) {
                    if (btns.length >= 12) return true;
                    if (!node || !gzClickable(node)) return false;
                    var t = gzTextOf(node);
                    if (!t || t.length > 12) return false;
                    btns.push(String(node.name || '?') + '/' + t);
                    return false;
                });
                gzWarn('手气卡弹窗里的可点按钮：' + (btns.join(' | ') || '(没有)'));
            } catch (e) {}
        }

        // 真正点下去：同一条提示最多点 GZ_ML_MAX_SAME 次，点不掉就停手
        // 原生关窗：小抄本体对 ShouQiKaAskWindow 就是用窗口自己的 CloseWin()。
        // 只关窗、绝不碰手气卡；不同版本关窗方法名不一样，多试几个。
        function gzMlTryNativeClose(win) {
            if (!win) return false;
            var names = ['CloseWin', 'onClickClose', 'closeWin', 'Close', 'close', 'hide'];
            var wname = gzNodeName(win) || 'ShouQiKaAskWindow';
            for (var i = 0; i < names.length; i++) {
                var fn = null;
                try { fn = win[names[i]]; } catch (e) { fn = null; }
                if (typeof fn !== 'function') continue;
                try {
                    fn.call(win);
                    gzMl.clicks += 1;
                    gzMl.lastClickAt = Date.now();
                    gzMl.lastKey = '';
                    gzMl.sameCount = 0;
                    gzLog('手气卡弹窗 ' + wname + ' → 调用 ' + names[i] + '()（原生关窗，不碰手气卡）');
                    return true;
                } catch (e2) { gzWarn('调用 ' + names[i] + '() 失败', e2); }
            }
            return false;
        }

        function gzMlClick(key, btn) {
            if (!btn || !btn.node) return false;
            // 双保险：绝不把手气卡「使用/更换」按钮当成拒绝来点
            if (gzMlLooksUse(btn.label)) {
                gzWarn('跳过「' + btn.label + '」：它看起来是「使用/更换手气卡」，不当成拒绝点');
                return false;
            }
            if (key === gzMl.lastKey) gzMl.sameCount = (gzMl.sameCount || 0) + 1;
            else { gzMl.lastKey = key; gzMl.sameCount = 1; }
            if (gzMl.sameCount > GZ_ML_MAX_SAME) {
                if (!gzMl.diag) {
                    gzMl.diag = true;
                    gzWarn('同一条手气卡提示「' + key + '」点了 ' + GZ_ML_MAX_SAME + ' 次还没关掉，先停手');
                    gzMlDumpWindow(gzMl.lastRoot || btn.node);
                }
                // 点了半天还没关掉 → 再试原生关窗（只关窗、不碰手气卡）
                gzMlTryNativeClose(gzMl.lastRoot || btn.node);
                return false;
            }
            gzMl.clicks += 1;
            gzMl.lastClickAt = Date.now();
            gzLog(key + ' → 点「' + (btn.label || '取消') + '」（' + btn.route + '）');
            return GAME.pressButton(btn.node);
        }

        // 主入口：有手气卡弹窗/提示就点取消；没有就返回 false，不干扰别的流程。
        // 外面套一层 busy 防重入：控制台即时线索会在 console.log 里同步再调一次。
        function gzTryCloseMulligan() {
            if (!gzMlActive()) return false;                // 只在「盖主速刷」开着时管手气卡
            if (gzMl.busy) return false;
            gzMl.busy = true;
            try { return gzMlRun(); }
            finally { gzMl.busy = false; }
        }

        function gzMlRun() {
            var sc = null;
            try { sc = GAME.scene(); } catch (e) { sc = null; }

            // ① 手气卡弹窗（ShouQiKaAskWindow）：认名字最准
            var wins = gzMlWindows();
            var win = null;
            for (var i = 0; i < wins.length; i++) {
                if (wins[i] && !wins[i].destroyed && wins[i].visible !== false) { win = wins[i]; break; }
            }
            if (win) {
                var wname = gzNodeName(win) || 'ShouQiKaAskWindow';
                gzMl.lastRoot = win;
                gzMlTouch();                 // 看到弹窗：续热区 + 顺延托管守备
                if (!gzMl.winLogged) {
                    gzMl.winLogged = true;
                    gzLog('找到手气卡弹窗：' + wname + '（开始尝试拒掉，绝不点「使用/更换」）');
                    gzMlDumpWindow(win);      // 打出窗口文字与可点按钮，方便排查
                }
                // ① 文案能精确对上「取消 / 不使用 / …」→ 点它
                var wbtn = gzMlFindDeclineIn(win, '手气卡弹窗', true);
                if (wbtn) return gzMlClick('手气卡弹窗 ' + wname, wbtn);
                // ② 文案对不上时优先用窗口自己的关窗方法（原版对 ShouQiKaAskWindow 就是用 CloseWin 拒的）
                if (gzMlTryNativeClose(win)) {
                    gzLog('手气卡弹窗 ' + wname + ' 已用原生关窗拒掉');
                    return true;
                }
                // ③ 最后才用包含匹配 / 「使用按钮的对面」
                wbtn = gzMlFindDeclineIn(win, '手气卡弹窗', false) ||
                    gzMlOtherOfUseIn(win, '手气卡弹窗(使用按钮的对面)');
                if (wbtn) return gzMlClick('手气卡弹窗 ' + wname, wbtn);
                if (!gzMl.diag) {
                    gzMl.diag = true;
                    gzWarn('看到手气卡弹窗「' + wname + '」，但没找到「取消」按钮，原生关窗也失败');
                    gzMlDumpWindow(win);
                }
                return false;
            }

            // ② 没有弹窗：按关键词找（提示正文 → 局内界面文字 → 可见窗口文字）
            var gs = null;
            try { gs = GAME.gamescene(); } catch (e) { gs = null; }
            var self = gs && gs.SelfSeatUi;
            var text = '';
            try {
                var ctx = self && self.cardContainer && self.cardContainer.selectCardContext;
                if (ctx && ctx.message) text = String(ctx.message).replace(/<[^>]*>/g, '');
            } catch (e) {}
            if (!text) {
                try {
                    var tf = self && self.buttonBar && self.buttonBar.txtOptMsg;
                    if (tf && tf._innerHTML) text = String(tf._innerHTML).replace(/<[^>]*>/g, '');
                } catch (e) {}
            }
            var hitText = GZ_ML_KEYWORD_RE.test(text) ? gzTrim(text) : '';
            // 整树/窗口文字扫描限速（没弹窗时每拍整树扫太费，会被拖慢到几百 ms）；
            // 手气卡风险窗口里不降速
            var deep = gzMlRisk() || (Date.now() - (gzMl.lastDeepText || 0) > 800);
            if (!hitText && sc && deep) {
                gzMl.lastDeepText = Date.now();
                hitText = gzFindText(sc, GZ_ML_KEYWORD_RE);
            }
            if (!hitText && deep) {
                var list = GAME.allWindows();
                for (var k = 0; k < list.length && !hitText; k++) {
                    var w2 = list[k].win;
                    if (!w2 || w2.destroyed || w2.visible === false) continue;
                    hitText = gzFindText(w2, GZ_ML_KEYWORD_RE);
                }
            }
            if (hitText) gzMlTouch();        // 看到含「手气卡」的提示：续热区 + 顺延托管守备
            if (!hitText) {
                gzMl.lastKey = '';
                gzMl.sameCount = 0;
                gzMl.diag = false;
                gzMl.lastRoot = null;
                gzMlNoteMiss('既没找到手气卡弹窗，也没找到含「手气卡」的提示文字（窗口名/结构可能变了）');
                return false;
            }
            // 按钮栏 → 含关键词的提示块 → 全场景 → 窗口
            var bar = self && self.buttonBar;
            var btns = (bar && bar.btns) || [];
            var j, b, label, usable;
            if (bar && bar.visible !== false && btns.length) {
                usable = [];
                for (j = 0; j < btns.length; j++) {
                    b = btns[j];
                    if (!b || !gzUsable(b)) continue;
                    usable.push(b);
                    label = gzMlLabel(b);
                    if (String(b.name || '') === 'btnCancel' || GZ_ML_DECLINE_RE.test(label)) {
                        return gzMlClick('提示「' + hitText + '」', { node: b, label: label || b.name, route: '按钮栏' });
                    }
                }
                if (usable.length === 2) {
                    // 只在能认出「使用/更换」按钮时才点它对面那个；认不出就不点（别赌第二个）
                    var cand = [];
                    for (var ci = 0; ci < usable.length; ci++) {
                        cand.push({ node: usable[ci], label: gzMlLabel(usable[ci]) });
                    }
                    var other = gzMlOtherOfUse(cand, '按钮栏(使用按钮的对面)');
                    if (other) return gzMlClick('提示「' + hitText + '」', other);
                }
            }
            var roots = sc ? [sc] : [];
            var wl = GAME.allWindows();
            for (j = 0; j < wl.length; j++) {
                if (wl[j].win && roots.indexOf(wl[j].win) < 0) roots.push(wl[j].win);
            }
            for (j = 0; j < roots.length; j++) {
                var kw = null;
                gzWalkNodes(roots[j], 0, function (node) {
                    var t = gzTextOf(node);
                    if (t && GZ_ML_KEYWORD_RE.test(t)) { kw = node; return true; }
                    return false;
                });
                if (!kw) continue;
                var panel = kw;
                for (var u = 0; u < 3 && panel && panel.parent; u++) panel = panel.parent;
                var hit = gzMlFindDeclineIn(panel, '提示框内') || gzMlFindDeclineIn(roots[j], '界面文字');
                if (hit) return gzMlClick('提示「' + hitText + '」', hit);
            }
            if (!gzMl.diag) {
                gzMl.diag = true;
                gzWarn('看到手气卡提示「' + hitText + '」，但没找到「取消」按钮');
                gzMlDumpWindow(sc);
            }
            gzMlNoteMiss('找到了「手气卡」提示文字，但没找到可点的「取消/不使用」按钮');
            return false;
        }

        /* ==================== 濒死/询问类提示：点取消 ====================
         * 移植小抄 uO(...,'btnCancel')：按钮栏里找名为 btnCancel 的按钮；
         * 房主额外允许按文案「取消」点（濒死求桃那类）。
         * ============================================================== */
        function gzTryCancelPrompt(kind) {
            var gs = null;
            try { gs = GAME.gamescene(); } catch (e) { gs = null; }
            var self = gs && gs.SelfSeatUi;
            if (!self) return false;
            var bar = self.buttonBar;
            if (!bar || bar.visible === false) return false;
            var btns = bar.btns || [];
            var i, b, label;
            // ① 按钮名叫 btnCancel 的
            for (i = 0; i < btns.length; i++) {
                b = btns[i];
                if (b && b.name === 'btnCancel' && gzUsable(b)) return GAME.pressButton(b);
            }
            // ② 按文案认「取消 / 不使用 / 否 / 关闭 / 放弃 / 跳过」
            if (kind === 'host' || kind === 'rebel') {
                for (i = 0; i < btns.length; i++) {
                    b = btns[i];
                    label = gzMlLabel(b);
                    if (b && gzUsable(b) && GZ_ML_DECLINE_LABELS.indexOf(label) >= 0) return GAME.pressButton(b);
                }
            }
            // ③ 反贼：实在认不出文案才退到「第二个可用按钮」，而且**手气卡守备期间一律不碰**：
            //    手气卡弹窗的第二项很可能就是「使用 / 更换手牌」，点下去就等于把手气卡用掉了。
            if (kind === 'rebel' && !gzMlGuarded()) {
                var usable = [];
                for (i = 0; i < btns.length; i++) if (btns[i] && gzUsable(btns[i])) usable.push(btns[i]);
                if (usable.length >= 2) {
                    var second = usable[1];
                    var secondLabel = gzMlLabel(second);
                    var barText = '';
                    try {
                        var tf = bar.txtOptMsg;
                        if (tf && tf._innerHTML) barText = String(tf._innerHTML).replace(/<[^>]*>/g, '');
                    } catch (e) {}
                    if (gzMlLooksUse(secondLabel) || GZ_ML_KEYWORD_RE.test(barText)) {
                        gzWarn('疑似手气卡提示（' + (barText || secondLabel || '?') +
                            '），不点第二个按钮，避免误用手气卡');
                        return false;
                    }
                    gzLog('询问框认不出「取消」，改点第二项：' + (secondLabel || second.name || '第2个'));
                    return GAME.pressButton(second);
                }
            }
            return false;
        }

        /* ==================== 结算：点空白处回房间 ==================== */
        var GZ_BLANK_POINTS = [
            [0.50, 0.88], [0.50, 0.12], [0.10, 0.50], [0.90, 0.50],
            [0.50, 0.50], [0.08, 0.08], [0.92, 0.92]
        ];
        var gzOver = { at: 0, tries: 0, last: 0 };

        function gzGameCanvas() {
            var L = null;
            try { L = window.Laya; } catch (e) { L = null; }
            var cands = [];
            try { if (L && L.stage && L.stage.canvas) cands.push(L.stage.canvas); } catch (e) {}
            try { if (L && L.stage && L.stage._canvas) cands.push(L.stage._canvas); } catch (e) {}
            try { if (L && L.Browser && L.Browser.canvas) cands.push(L.Browser.canvas); } catch (e) {}
            try { var byId = document.getElementById('layaCanvas'); if (byId) cands.push(byId); } catch (e) {}
            try {
                var all = document.querySelectorAll('canvas');
                for (var i = 0; i < all.length; i++) cands.push(all[i]);
            } catch (e) {}
            // 页面上可能有多个 canvas，游戏画布是最大的那个
            var best = null, bestArea = -1;
            for (var j = 0; j < cands.length; j++) {
                var c = cands[j];
                if (!c) continue;
                var w = Number(c.clientWidth || c.width) || 0;
                var h = Number(c.clientHeight || c.height) || 0;
                if (w * h > bestArea) { bestArea = w * h; best = c; }
            }
            return best;
        }

        function gzMakeMouseEvent(type, x, y) {
            try {
                return new MouseEvent(type, {
                    bubbles: true, cancelable: true, view: window,
                    clientX: x, clientY: y, button: 0
                });
            } catch (e) {}
            try {
                var ev = document.createEvent('MouseEvents');
                ev.initMouseEvent(type, true, true, window, 0, 0, 0, x, y, false, false, false, false, 0, null);
                return ev;
            } catch (e2) {}
            return null;
        }

        // iPad / 触屏客户端：Laya 在移动端 UA 下只挂 touch 监听，合成鼠标事件点不动画面
        function gzTouchMode() {
            try {
                var L = window.Laya;
                if (L && L.Browser) {
                    if (L.Browser.onMobile === true || L.Browser.onIOS === true || L.Browser.onAndroid === true) return true;
                }
            } catch (e) {}
            try {
                return /iPad|iPhone|iPod|Android|Mobile/i.test(String(navigator.userAgent || ''));
            } catch (e) { return false; }
        }

        function gzMakeTouchEvent(type, x, y, target) {
            var t = target;
            if (!t) t = document.body || document.documentElement;
            if (!t) return null;
            try {
                var touch = new Touch({
                    identifier: Date.now() % 100000,
                    target: t,
                    clientX: x, clientY: y,
                    pageX: x + (window.pageXOffset || 0),
                    pageY: y + (window.pageYOffset || 0),
                    screenX: x, screenY: y,
                    radiusX: 1, radiusY: 1, force: 1
                });
                return new TouchEvent(type, {
                    bubbles: true, cancelable: true, composed: true,
                    touches: type === 'touchend' ? [] : [touch],
                    targetTouches: type === 'touchend' ? [] : [touch],
                    changedTouches: [touch]
                });
            } catch (e) {}
            try {
                var ev = document.createEvent('TouchEvent');
                ev.initEvent(type, true, true);
                return ev;
            } catch (e2) {}
            return null;
        }

        function gzNodeText(node) {
            try {
                var t = node.text;
                if (t == null && node._text) t = node._text.text != null ? node._text.text : node._text;
                return gzTrim(t || '');
            } catch (e) { return ''; }
        }

        // 结算界面上写着「点击空白处 / 继续 / 任意处」的节点（Laya.Text 之类）
        function gzFindContinueNode() {
            var gs = null;
            try { gs = GAME.gamescene(); } catch (e) { gs = null; }
            if (!gs) return null;
            var found = null;
            (function walk(node, depth) {
                if (!node || found || depth > 9) return;
                var kids = [];
                try { kids = node._children || []; } catch (e) { return; }
                for (var i = 0; i < kids.length; i++) {
                    var c = kids[i];
                    if (!c) continue;
                    var txt = gzNodeText(c);
                    if (txt && GZ_CONTINUE_TEXT_RE.test(txt)) { found = c; return; }
                    walk(c, depth + 1);
                    if (found) return;
                }
            })(gs, 0);
            if (!found) return null;
            // 往上找可点的祖先
            var n = found;
            for (var i = 0; i < 8 && n; i++) {
                try {
                    if (typeof n.onClick === 'function' || typeof n.onMouse === 'function' || typeof n.click === 'function') return n;
                } catch (e) {}
                n = n.parent;
            }
            return found;
        }

        function gzDispatchMouseAt(x, y) {
            var sent = false;
            var canvas = gzGameCanvas();
            ['mousedown', 'mouseup', 'click'].forEach(function (type) {
                var ev = gzMakeMouseEvent(type, x, y);
                if (!ev) return;
                try { if (canvas) { canvas.dispatchEvent(ev); sent = true; } } catch (e) {}
                try { document.dispatchEvent(gzMakeMouseEvent(type, x, y)); sent = true; } catch (e) {}
            });
            // 触屏模式补一套 touch 事件（Laya 移动端只认 touch；桌面端没挂 touch 监听，补发无副作用）
            if (gzTouchMode()) {
                ['touchstart', 'touchend'].forEach(function (type) {
                    var target = canvas || document.body || document.documentElement;
                    var ev = gzMakeTouchEvent(type, x, y, target);
                    if (!ev) return;
                    try { if (canvas) { canvas.dispatchEvent(ev); sent = true; } } catch (e) {}
                    try { document.dispatchEvent(gzMakeTouchEvent(type, x, y, document)); sent = true; } catch (e) {}
                });
            }
            return sent;
        }

        // 结算界面：先找「点击空白处/继续」的节点直接点，再退回到真实鼠标事件
        function gzClickBlank() {
            var canvas = gzGameCanvas();
            var rect = null;
            try { rect = canvas && canvas.getBoundingClientRect(); } catch (e) { rect = null; }
            if (!rect || !rect.width || !rect.height) {
                rect = {
                    left: 0, top: 0,
                    width: (canvas && canvas.clientWidth) || 1024,
                    height: (canvas && canvas.clientHeight) || 640
                };
            }
            var pt = GZ_BLANK_POINTS[gzOver.tries % GZ_BLANK_POINTS.length];
            var x = rect.left + rect.width * pt[0];
            var y = rect.top + rect.height * pt[1];

            var node = gzFindContinueNode();
            if (node) {
                var txt = gzNodeText(node);
                if (GAME.pressButton(node) || GAME.click(node)) {
                    gzLog('结算界面：点了「' + (txt || gzNodeName(node) || '继续') + '」节点（第 ' + gzOver.tries + ' 次）');
                    return true;
                }
                // 节点本身不可点：就在它所在的位置点一下（那句话写的就是「点击空白处」）
                var pos = gzNodeGlobalPos(node);
                if (gzDispatchMouseAt(rect.left + pos.x, rect.top + pos.y)) {
                    gzLog('结算界面：在「' + (txt || '继续') + '」的位置点了一下（第 ' + gzOver.tries + ' 次）');
                    return true;
                }
            }

            if (!canvas) {
                gzWarn('结算界面：找不到游戏画布，只能在 document 上派发鼠标事件');
            }
            var sent = gzDispatchMouseAt(x, y);
            if (sent) {
                gzLog('结算界面：点击空白处（第 ' + gzOver.tries + ' 次 @ ' +
                    Math.round(pt[0] * 100) + '%/' + Math.round(pt[1] * 100) + '%）');
            }
            return sent;
        }

        // 结算界面统一处理：返回 true 表示“正在等待回房间，本轮不要再做别的”
        function gzSettleTick() {
            if (!gzOver.at) return false;
            var now = Date.now();
            if (now - gzOver.at < 1200) return true;          // 刚结束，先让结算动画出来
            if (gzOver.tries < 20 && now - gzOver.last > 1500) {
                gzOver.last = now;
                gzOver.tries += 1;
                gzClickBlank();
            }
            return true;
        }

        gzOn('MsgGameOver', function () {
            if (!gzHost.on && !gzRebel.on) return;
            gzOver.at = Date.now();
            gzOver.tries = 0;
            gzOver.last = 0;
            gzLog('对局结束，等待结算：会自动点空白处回房间');
        });
        gzOn('ClientLeavetableRep', function () { gzOver.at = 0; gzOver.tries = 0; });
        gzOn('ClientLeaveTableRep', function () { gzOver.at = 0; gzOver.tries = 0; });

        // 反贼：托管（小抄 pK / 自动挂机里也是调 SelfSeatUi.onTrusteeshipClick）
        function gzTryTrustee(gs) {
            var self = gs && gs.SelfSeatUi;
            if (!self) return false;
            var seat = self.seat || self.Seat;
            var now = Date.now();
            // 手气卡守备：开局 20 秒内 / 选将后 10 秒内 / 每次看到或收到手气卡提示后的 20 秒内，
            // 都不开托管。托管/自动状态会让客户端自己把手气卡用掉（原版小抄也是靠「自动模式下
            // 关掉 ShouQiKaAskWindow」避免这件事的）。**这段检查必须在「已在托管就直接返回」之前**：
            // 上一局留下的托管状态如果还在，就会在我们设置守备之前把手气卡用掉。
            if (gzMlGuarded()) {
                try {
                    if (seat && seat.IsAiControl && (gzRebel.trusteeOffTries || 0) < 3 &&
                        now - (gzRebel.trusteeOffAt || 0) > 1200 &&
                        typeof self.onTrusteeshipClick === 'function') {
                        gzRebel.trusteeOffAt = now;
                        gzRebel.trusteeOffTries = (gzRebel.trusteeOffTries || 0) + 1;
                        self.onTrusteeshipClick();
                        gzLog('手气卡守备：检测到已开托管，先关掉（第 ' + gzRebel.trusteeOffTries + ' 次）');
                    } else if (seat && seat.IsAiControl && gzRebel.trusteeOffTries >= 3 &&
                        !gzRebel.trusteeOffWarned) {
                        gzRebel.trusteeOffWarned = true;
                        gzWarn('手气卡守备：托管关了 3 次仍是开启状态，停止再点，避免来回切换');
                    }
                } catch (e) {}
                if (!gzRebel.trusteeHoldLogged) {
                    gzRebel.trusteeHoldLogged = true;
                    var holdUntil = Number(gzRebel.trusteeHoldUntil) || 0;
                    gzLog('手气卡守备中（' + (gzMl.noticeText || 'ShouQiKaAskWindow') + '），暂缓开启托管' +
                        (holdUntil > now
                            ? ('，开局守备还剩 ' + Math.ceil((holdUntil - now) / 1000) + ' 秒')
                            : '，等提示清掉再开'));
                }
                return false;
            }
            try {
                if (seat && seat.IsAiControl) {
                    gzRebel.trusteeDone = true;
                    return true;
                }
            } catch (e) {}
            if (gzRebel.trusteeDone) return true;
            // 有询问/确认框就先按「取消 / 第二项」处理掉 —— 托管经常就是被这类框挡住的
            if (gzRebel.cancelCount < GZ_CANCEL_MAX_PER_GAME && gzTryCancelPrompt('rebel')) {
                gzRebel.cancelCount += 1;
                return true;
            }
            if (now - (gzRebel.trusteeAt || 0) < GZ_TRUSTEE_RETRY_MS) return false;
            gzRebel.trusteeAt = now;
            if (typeof self.onTrusteeshipClick !== 'function') {
                // 托管只是「顺手开一下」，开不了不该把整个反贼停掉
                gzWarn('当前对局找不到托管按钮，先继续（反贼照常准备/循环）');
                gzRebel.trusteeDone = true;
                return false;
            }
            gzRebel.trusteeTries += 1;
            if (gzRebel.trusteeTries > GZ_TRUSTEE_MAX) {
                gzWarn('开启托管失败（重试 ' + GZ_TRUSTEE_MAX + ' 次），先继续（不再因此停掉反贼）');
                gzRebel.trusteeDone = true;
                return false;
            }
            try {
                self.onTrusteeshipClick();
                gzLog('已请求托管（第 ' + gzRebel.trusteeTries + ' 次）');
            } catch (e) {
                gzWarn('托管失败', e);
            }
            return true;
        }

        /* ==================== 场景判定与状态机 ==================== */
        function gzSceneInfo() {
            var sc = null;
            try { sc = GAME.scene(); } catch (e) { sc = null; }
            var name = '';
            if (sc) { try { name = String(sc.SceneName || sc.name || ''); } catch (e) { name = ''; } }
            var isGame = name === 'GameScene';
            if (!isGame) { try { isGame = !!GAME.gamescene(); } catch (e) { isGame = false; } }
            return { sc: sc, name: name, isGame: isGame };
        }

        function gzStepHost() {
            var info = gzSceneInfo();
            // 手气卡弹窗优先：它有倒计时、又可能和选将同框出现，先把它拒掉（没弹窗时秒返回 false）
            if (gzTryCloseMulligan()) return;                        // 手气卡弹窗 ShouQiKaAskWindow
            // 选将：只要看到选将界面就先处理，不依赖「当前算不算对局中」的场景判定
            if (gzHandleHostSelect()) return;
            if (gzHost.cancelCount < GZ_CANCEL_MAX_PER_GAME && gzTryCancelPrompt('host')) {
                gzHost.cancelCount += 1;
                return;
            }
            if (!info.sc) return;
            if (info.isGame) { gzStepHostGame(); return; }
            if (info.name === 'TableScene' || info.sc.seatListView) { gzStepHostRoom(info.sc); }
        }

        // 盖主选将：认到界面就点黄盖；认出界面但没黄盖会打出一份候选清单方便排查
        function gzHandleHostSelect() {
            var win = gzVisibleSelectWindow();
            var now = Date.now();
            if (!win) {
                if (gzHost.selectFirstSeen) gzHost.selectGoneAt = now;
                return false;
            }
            if (!gzHost.selectFirstSeen || (gzHost.selectGoneAt && now - gzHost.selectGoneAt > 2000)) {
                gzHost.selectFirstSeen = now;
                gzHost.selectGoneAt = 0;
                gzHost.selectDone = false;
                gzHost.selectLogged = false;
                gzLog('检测到选将界面（' + gzNodeName(win) + '）');
            }
            if (gzHost.selectDone) return true;
            if (!gzHost.selectLogged && now - gzHost.selectFirstSeen > 400) {
                gzHost.selectLogged = true;
                gzLog(gzCardDump(win));
            }
            if (now - gzHost.selectFirstSeen > GZ_SELECT_TIMEOUT_MS) {
                gzFailHost('本次选将未找到' + GZ_HOST_GENERAL + '，已停止挂机');
                return true;
            }
            var card = gzPickGeneralCard(win, gzHost.generalId, GZ_HOST_GENERAL);
            if (card && gzClickGeneralCard(win, card)) {
                gzHost.selectDone = true;
                gzMl.postSelectAt = Date.now();
                gzLog('已选择' + (card.name || GZ_HOST_GENERAL) + '#' + card.id);
            }
            return true;
        }

        function gzStepHostRoom(sc) {
            if (gzHost.phase !== 'room') {
                gzHost.phase = 'room';
                gzHost.djDone = false;
                gzHost.djPending = false;
                gzHost.djOn = false;
                gzHost.djOpenTried = 0;
                gzHost.djOpenMiss = 0;
                gzHost.djOpenAt = 0;
                gzHost.roomLogged = false;
                gzHost.djSeq = (gzHost.djSeq || 0) + 1;   // 作废上一轮还没回来的点将结果
                gzHost.aiDone = false;
                gzHost.aiTries = 0;
                gzHost.aiAt = 0;
                gzHost.aiConfirmPending = false;
                gzHost.startTries = 0;
                gzHost.startAt = 0;
                gzHost.selectDone = false;
                gzHost.selectFirstSeen = 0;
                gzOver.at = 0;
                gzOver.tries = 0;
                gzHost.roomFlowAt = Date.now();     // 用来量「进房 → 点将完成」花了多久
                gzLog('盖主（小号）：在房间里，开始新一轮');
            }
            // 诊断：进房后打一次房间界面上能看见的文字，方便确认按钮名
            if (!gzHost.roomLogged) {
                gzHost.roomLogged = true;
                try { gzLog('房间界面文字：' + (gzCollectTexts(sc, [], 24).join('、') || '(没读到)')); } catch (e) {}
                try {
                    var dv = sc.dianjiangView;
                    gzLog('点将视图：' + (dv
                        ? ('有，武将卡 ' + ((dv.generalUis && dv.generalUis.length) || 0) + ' 张，' +
                           (dv.manger ? '有 manger' : '无 manger') + '，' +
                           (typeof dv.onOpenDJClick === 'function' ? '有 onOpenDJClick' : '无 onOpenDJClick'))
                        : '没有'));
                } catch (e) {}
            }
            if (gzHost.djPending) return;
            // 先把「开启点将」打开（不依赖小抄配置/武将ID），开了才继续点黄盖
            if (!gzHost.djDone) {
                if (!gzHostEnsureDianjiangOpen(sc)) return;
                gzHostDianjiang(sc);
                return;
            }
            if (!gzHost.aiDone) { gzHostFillAi(sc); return; }
            gzHostStart(sc);
        }

        // 盖主（小号）如果被开了托管，手气卡守备期内也先关掉：托管同样会替玩家点「使用手气卡」
        function gzHostTrusteeGuard() {
            if (!gzMlGuarded()) return;
            var gs = null;
            try { gs = GAME.gamescene(); } catch (e) { gs = null; }
            var self = gs && gs.SelfSeatUi;
            var seat = self && (self.seat || self.Seat);
            if (!seat || !seat.IsAiControl) return;
            var now = Date.now();
            if ((gzHost.trusteeOffTries || 0) >= 3) {
                if (!gzHost.trusteeOffWarned) {
                    gzHost.trusteeOffWarned = true;
                    gzWarn('手气卡守备：盖主（小号）的托管关了 3 次仍是开启状态，停止再点');
                }
                return;
            }
            if (now - (gzHost.trusteeOffAt || 0) < 1200) return;
            if (typeof self.onTrusteeshipClick !== 'function') return;
            gzHost.trusteeOffAt = now;
            gzHost.trusteeOffTries = (gzHost.trusteeOffTries || 0) + 1;
            self.onTrusteeshipClick();
            gzLog('手气卡守备：盖主（小号）已开托管，先关掉（第 ' + gzHost.trusteeOffTries + ' 次）');
        }

        function gzStepHostGame() {
            var now = Date.now();
            if (gzHost.phase !== 'game') {
                gzHost.phase = 'game';
                gzHost.gameEnteredAt = now;
                gzHost.selectDone = false;
                gzHost.selectFirstSeen = 0;
                gzHost.kourouAt = 0;
                gzHost.kourouCount = 0;
                gzHost.cancelCount = 0;
                gzHost.waitStartAt = 0;
                gzHost.delayDone = false;
                gzHost.delayNoTimerLogged = false;
                gzHost.trusteeOffAt = 0;
                gzHost.trusteeOffTries = 0;
                gzHost.trusteeOffWarned = false;
                gzMl.postSelectAt = 0;
                gzCd.obj = null;
                gzCd.at = 0;
                gzHost.stuckLogged = false;
                gzOver.at = 0;
                gzOver.tries = 0;
                gzHost.gameLogged = false;
                gzLog('盖主（小号）：进入对局');
            }
            // 诊断：进局 8 秒内打一次提示文字/按钮/可见窗口
            if (!gzHost.gameLogged) {
                gzHost.gameLogged = true;
                try {
                    var gs2 = GAME.gamescene();
                    var self2 = gs2 && gs2.SelfSeatUi;
                    var dbgText = '';
                    var dbgBtns = (self2 && self2.buttonBar && self2.buttonBar.btns) || [];
                    try {
                        var dbgTf = self2 && self2.buttonBar && self2.buttonBar.txtOptMsg;
                        if (dbgTf && dbgTf._innerHTML) dbgText = String(dbgTf._innerHTML).replace(/<[^>]*>/g, '');
                    } catch (e) {}
                    var dbgArr = [];
                    for (var bi = 0; bi < dbgBtns.length; bi++) {
                        dbgArr.push(String(dbgBtns[bi] && dbgBtns[bi].name || '?') + '/' + gzMlLabel(dbgBtns[bi]));
                    }
                    gzLog('局内提示=' + JSON.stringify(dbgText) + ' 按钮=' + (dbgArr.join(' | ') || '(无)'));
                    var names = [];
                    var wl = GAME.allWindows();
                    for (var wi = 0; wi < wl.length; wi++) {
                        var ww = wl[wi].win;
                        if (ww && !ww.destroyed && ww.visible !== false) names.push(wl[wi].name);
                    }
                    gzLog('可见窗口：' + (names.join('、') || '(无)'));
                    gzLog('局内界面文字：' + (gzCollectTexts(gs2, [], 24).join('、') || '(没读到)'));
                } catch (e) {}
            }
            if (gzSettleTick()) return;          // 结算中：点空白处，等回房间
            gzHostTrusteeGuard();                // 手气卡守备：盖主若被开了托管，先关掉
            if (gzHostBurningBar(now)) return;   // 「等1分钟」：烧条到剩 3 秒再苦肉
            if (gzHost.kourouCount < GZ_KUROU_MAX_PER_GAME &&
                now - gzHost.kourouAt >= GZ_KUROU_MIN_GAP_MS && gzUseSkill(GZ_KUROU_NAME)) {
                gzHost.kourouAt = now;
                gzHost.kourouCount += 1;
                gzLog('发动苦肉（第 ' + gzHost.kourouCount + ' 次）');
                return;
            }
            if (now - (gzHost.gameEnteredAt || now) > 90000 && !gzHost.stuckLogged) {
                gzHost.stuckLogged = true;
                gzWarn('对局中 90 秒没有可执行动作，请检查是否卡在某个界面');
            }
        }

        function gzStepRebel() {
            var info = gzSceneInfo();
            // 手气卡弹窗优先：有倒计时、又可能和选将同框出现，先拒掉再选将（没弹窗时秒返回 false）
            if (gzTryCloseMulligan()) return;          // 手气卡弹窗：立刻点取消
            if (gzHandleRebelSelect()) return;      // 选将，和场景判定解耦
            // 询问/确认框（含托管那类）：点「取消」，认不出就点第二项
            if (gzRebel.cancelCount < GZ_CANCEL_MAX_PER_GAME && gzTryCancelPrompt('rebel')) {
                gzRebel.cancelCount += 1;
                return;
            }
            if (!info.sc) return;
            if (info.isGame) { gzStepRebelGame(); return; }
            if (info.name === 'TableScene' || info.sc.seatListView) { gzStepRebelRoom(info.sc); }
        }

        // 不点将（off）模式也要用百胜数据：选将框里按「按序点将」的排序挑人。
        // 小抄配置还没读到时不发请求（等选将框那边再试），已有同一昵称的请求在飞也不重复发。
        function gzRebelBoxAchQuery(reason) {
            if (!gzAchDefs()) return;
            if (gzAch.pending) return;
            gzAchQuery(reason).then(function () {});
        }

        // 不点将：没有点将槽可用，就直接在选将框里按「按序点将」的排序挑：
        // 技能战功已完成的优先，其次百胜进度多的；框里能选的都刷满百胜 → 随机挑一个。
        // 返回 null 表示「百胜数据还在路上」，这一拍先不选（最多等 GZ_SELECT_BOX_ACH_WAIT_MS）。
        function gzPickRebelOffCard(win, now) {
            var all = gzGeneralCards(win);
            if (!all.length) return null;
            var pool = [];
            var i;
            for (i = 0; i < all.length; i++) {
                var nm = String(all[i].name || '');
                if (nm && nm.indexOf('黄盖') >= 0) continue;              // 跟小号的黄盖撞车
                if (all[i].id > 0 && gzIsRebelBannedGeneral(all[i].id)) continue;
                pool.push(all[i]);
            }
            var onlyBanned = false;
            if (!pool.length) {                                          // 框里只剩黄盖变体：只能随便选一个
                onlyBanned = true;
                pool = all.slice();
            }
            var ev = gzAchEval(false);
            if (!ev) {
                if (!gzRebel.boxAchAt) {
                    gzRebel.boxAchAt = now;
                    gzRebelBoxAchQuery('select-box');
                }
                if (now - gzRebel.boxAchAt < GZ_SELECT_BOX_ACH_WAIT_MS) return null;
                var fallback = gzShufflePick(pool);
                if (!gzRebel.boxPickLogged) {
                    gzRebel.boxPickLogged = true;
                    gzWarn('不点将：等不到百胜数据，选将框里随机选「' + (fallback.name || fallback.id) + '」');
                }
                return fallback;
            }
            // 框里还没刷满百胜的，按「按序点将」排（同一个 gzPickOrdered，和按序点将口径一致）
            var ids = [];
            var byId = {};
            var left = [];
            for (i = 0; i < pool.length; i++) {
                if (pool[i].id > 0 && ev.completed[pool[i].id]) continue;
                left.push(pool[i]);
                if (pool[i].id > 0) { ids.push(pool[i].id); byId[pool[i].id] = pool[i]; }
            }
            var picked = null;
            var why = '';
            if (ids.length) {
                picked = byId[gzPickOrdered(ids, ev)] || null;
                why = '按序点将排序';
            }
            if (!picked && left.length) {
                picked = gzShufflePick(left);
                why = '能排名的都认不出 ID，随机';
            }
            if (!picked) {                                               // 框里都刷满百胜了
                picked = gzShufflePick(pool);
                why = '框里都刷满百胜了，随机';
            }
            if (onlyBanned) why += '（框里只剩黄盖/界黄盖）';
            if (!gzRebel.boxPickLogged && picked) {
                gzRebel.boxPickLogged = true;
                var extra = '';
                if (ev.details[picked.id]) {
                    extra = '，进度 ' + (Number(ev.details[picked.id].progress) || 0) +
                        '/' + (Number(ev.details[picked.id].required) || 0);
                }
                gzLog('不点将：' + why + '选中「' + (picked.name || gzGeneralNameById(picked.id)) + '」' +
                    (picked.id ? '#' + picked.id : '') + extra);
            }
            return picked;
        }

        function gzHandleRebelSelect() {
            var win = gzVisibleSelectWindow();
            var now = Date.now();
            if (!win) {
                if (gzRebel.selectFirstSeen) gzRebel.selectGoneAt = now;
                return false;
            }
            if (!gzRebel.selectFirstSeen || (gzRebel.selectGoneAt && now - gzRebel.selectGoneAt > 2000)) {
                gzRebel.selectFirstSeen = now;
                gzRebel.selectGoneAt = 0;
                gzRebel.selectDone = false;
                gzRebel.fallbackLogged = false;
                gzRebel.selectLogged = false;
                gzRebel.boxAchAt = 0;
                gzRebel.boxAchLogged = false;
                gzRebel.boxPickLogged = false;
                gzLog('反贼：检测到选将界面（' + gzNodeName(win) + '）');
            }
            if (gzRebel.selectDone) return true;
            if (!gzRebel.selectLogged && now - gzRebel.selectFirstSeen > 400) {
                gzRebel.selectLogged = true;
                gzLog(gzCardDump(win));
            }
            var card = null;
            if (gzRebel.djMode) {
                card = gzPickGeneralCard(win, gzRebel.generalId, gzRebel.generalName);
                if (!card && now - gzRebel.selectFirstSeen > GZ_SELECT_FALLBACK_MS) {
                    var cards = gzGeneralCards(win);
                    // 兜底也不选黄盖/界黄盖（跟小号的黄盖撞车）
                    for (var ci = 0; ci < cards.length; ci++) {
                        if (gzIsRebelBannedGeneral(cards[ci].id)) continue;
                        if (String(cards[ci].name || '').indexOf('黄盖') >= 0) continue;
                        card = cards[ci];
                        break;
                    }
                    if (card && !gzRebel.fallbackLogged) {
                        gzRebel.fallbackLogged = true;
                        gzWarn('选将列表里没有「' + gzRebel.generalName + '」，先随便选一个（不选黄盖）');
                    }
                }
                if (!card && now - gzRebel.selectFirstSeen > GZ_SELECT_TIMEOUT_MS) {
                    gzWarn('选将超时，等待游戏自动选将');
                    return true;
                }
            } else {
                // 不点将：优先按「按序点将」的排序从框里挑（框里都刷满百胜了才随机）
                card = gzPickRebelOffCard(win, now);
            }
            if (card && gzClickGeneralCard(win, card)) {
                gzRebel.selectDone = true;
                // 手气卡常在选将之后才弹：选将完成也顺延托管守备，别让托管抢在前面把手气卡用掉
                gzMl.postSelectAt = Date.now();
                gzMlExtendGuard(GZ_ML_POST_SELECT_GUARD_MS);
                gzLog('反贼（大号）已选将：' + (card.name || card.id));
            }
            return true;
        }

        function gzStepRebelRoom(sc) {
            if (gzRebel.phase === 'game') {
                gzRebel.phase = 'room';
                gzRebel.readyClicked = false;
                gzRebel.trusteeDone = false;
                gzRebel.trusteeHoldLogged = false;
                gzRebel.trusteeTries = 0;
                gzRebel.trusteeAt = 0;
                gzRebel.selectDone = false;
                gzRebel.selectFirstSeen = 0;
                gzRebel.fallbackLogged = false;
                gzRebel.djDone = false;
                gzRebel.djPending = false;
                gzRebel.djSeq = (gzRebel.djSeq || 0) + 1;   // 作废上一轮还没回来的点将结果
                gzRebel.slotWaitAt = 0;
                if (gzRebel.djMode) gzRebel.pendingAch = true;
                else gzRebelBoxAchQuery('room');   // 不点将：提前拉一次百胜数据，选将框里好按序挑
                gzOver.at = 0;
                gzOver.tries = 0;
                gzLog('反贼（大号）：对局结束，回到房间');
            }
            if (gzRebel.phase !== 'room') gzRebel.phase = 'room';
            if (gzRebel.pendingAch) { gzRebelAfterGame(); return; }
            if (gzRebel.djPending || gzRebel.achBusy) return;
            if (gzRebel.djMode && !(gzRebel.generalId > 0)) { gzRebelChooseGeneral(); return; }
            if (gzRebel.djMode && !gzRebel.djDone) { gzRebelDianjiang(sc); return; }
            gzRebelReady(sc);
        }

        function gzStepRebelGame() {
            var now = Date.now();
            if (gzRebel.phase !== 'game') {
                gzRebel.phase = 'game';
                gzRebel.selectDone = false;
                gzRebel.selectFirstSeen = 0;
                gzRebel.trusteeDone = false;
                gzRebel.trusteeHoldLogged = false;
                gzRebel.trusteeTries = 0;
                gzRebel.trusteeAt = 0;
                gzRebel.cancelCount = 0;
                gzRebel.fallbackLogged = false;
                gzRebel.trusteeHoldUntil = now + GZ_ML_TRUSTEE_GUARD_MS;
                gzRebel.mlRiskAt = now;
                gzRebel.trusteeOffAt = 0;
                gzRebel.trusteeOffTries = 0;
                gzRebel.trusteeOffWarned = false;
                gzMl.postSelectAt = 0;
                gzMl.seenAt = 0;
                gzOver.at = 0;
                gzOver.tries = 0;
                gzLog('反贼（大号）：进入对局（手气卡守备：' +
                    Math.round(GZ_ML_TRUSTEE_GUARD_MS / 1000) + ' 秒内不开托管）');
            }
            if (gzSettleTick()) return;          // 结算中：点空白处，等回房间
            gzTryTrustee(GAME.gamescene());
        }

        /* ==================== 反贼：百胜轮换 ==================== */
        function gzRebelChooseGeneral() {
            if (gzRebel.achBusy) return;
            // 随机点将要先知道点将槽里有没有人：读不到就先等界面就绪，免得把已有选择当「没选」覆写
            if (gzRebel.djPick === GZ_DJ_MODE_RANDOM) {
                var probe = gzConfiguredRebelGeneral(null);
                if (probe < 0) {
                    if (!gzRebel.slotWaitAt) {
                        gzRebel.slotWaitAt = Date.now();
                        gzLog('随机点将：暂时读不到点将槽，等界面就绪后再决定');
                    }
                    if (Date.now() - gzRebel.slotWaitAt < GZ_SLOT_READ_WAIT_MS) return;
                    gzWarn('随机点将：等了 ' + Math.round(GZ_SLOT_READ_WAIT_MS / 1000) +
                        ' 秒仍读不到点将槽，按未完成百胜随机挑一个');
                } else {
                    gzRebel.slotWaitAt = 0;
                }
            }
            gzRebel.achBusy = true;
            var runId = gzRebel.runId;
            gzAchQuery('auto-ready').then(function (snap) {
                gzRebel.achBusy = false;
                if (!gzAlive(gzRebel, runId)) return;
                if (!snap) {
                    gzRebel.achTries = (gzRebel.achTries || 0) + 1;
                    if (gzRebel.achTries < 5) {
                        gzLog('还没拿到百胜战功数据，稍后重试（第 ' + gzRebel.achTries + ' 次）');
                        return;
                    }
                    gzFailRebel('拿不到百胜战功数据（小抄配置未加载或昵称取不到）');
                    return;
                }
                gzRebel.achTries = 0;
                var ev0 = gzAchEval(false);
                var next = 0;
                // 随机点将：已经点好的武将没刷完百胜就继续用，不随机换人
                if (gzRebel.djPick === GZ_DJ_MODE_RANDOM) next = gzKeepConfiguredRebelGeneral(ev0);
                if (!(next > 0)) next = gzPickUnfinished(0, gzRebel.djPick);
                if (!(next > 0)) { gzFailRebel('没有可点的未完成百胜武将了（黄盖/界黄盖已按规则排除）'); return; }
                gzRebel.generalId = next;
                gzRebel.generalName = gzGeneralNameById(next);
                gzLog('反贼（大号）本轮点将：' + gzRebel.generalName +
                    '（' + gzDjModeLabel(gzRebel.djPick) + '）');
            });
        }

        function gzRebelAfterGame() {
            if (gzRebel.achBusy) return;
            gzRebel.achBusy = true;
            var runId = gzRebel.runId;
            var played = gzRebel.generalId;
            var playedName = gzRebel.generalName;
            gzAchQuery('settlement').then(function (snap) {
                gzRebel.achBusy = false;
                if (!gzAlive(gzRebel, runId)) return;
                gzRebel.pendingAch = false;
                if (!snap) { gzWarn('拿不到百胜战功数据，本轮继续用当前武将'); return; }
                var ev = gzAchEval(true);
                var detail = (ev && ev.details) ? ev.details[played] : null;
                if (detail && detail.completed) {
                    var next = 0;
                    // 随机点将：槽里若已经被换成另一名未完成百胜的武将，就用它；否则才随机挑下一个
                    if (gzRebel.djPick === GZ_DJ_MODE_RANDOM) next = gzKeepConfiguredRebelGeneral(ev);
                    if (!(next > 0)) next = gzPickUnfinished(played, gzRebel.djPick);
                    if (!(next > 0)) { gzFailRebel('没有可点的未完成百胜武将了（黄盖/界黄盖已按规则排除）'); return; }
                    gzRebel.generalId = next;
                    gzRebel.generalName = gzGeneralNameById(next);
                    gzLog('「' + playedName + '」百胜已完成，换将：' + gzRebel.generalName);
                    showToast('百胜完成：' + playedName + '，下一个 ' + gzRebel.generalName, 'green', 5000);
                } else if (detail) {
                    gzLog('「' + detail.name + '」百胜进度 ' + detail.progress + '/' + detail.required + '，继续');
                }
            });
        }

        function gzRebelDianjiang(sc) {
            if (gzRebel.djPending) return;
            var id = gzRebel.generalId;
            // 随机点将：写槽前再确认一次。槽里已有能继续刷的武将就绝不重写（「不切换武将」）。
            if (gzRebel.djPick === GZ_DJ_MODE_RANDOM) {
                var slotId = gzConfiguredRebelGeneral(sc);
                if (slotId < 0) {
                    if (!gzRebel.slotWaitAt) {
                        gzRebel.slotWaitAt = Date.now();
                        gzLog('随机点将：暂时读不到点将槽，先不写，等界面就绪');
                    }
                    if (Date.now() - gzRebel.slotWaitAt < GZ_SLOT_READ_WAIT_MS) return;
                    gzWarn('随机点将：等了 ' + Math.round(GZ_SLOT_READ_WAIT_MS / 1000) +
                        ' 秒仍读不到点将槽，按当前武将写槽');
                } else {
                    gzRebel.slotWaitAt = 0;
                    if (gzSlotGeneralUsable(slotId, gzAchEval(false))) {
                        if (id !== slotId) {
                            gzRebel.generalId = slotId;
                            gzRebel.generalName = gzGeneralNameById(slotId);
                            gzLog('点将槽已选「' + gzRebel.generalName + '」(ID ' + slotId +
                                ')，随机点将不切换，也不重写槽位');
                        } else {
                            gzLog('点将槽已经是「' + (gzRebel.generalName || gzGeneralNameById(slotId)) +
                                '」(ID ' + slotId + ')，本轮不重写槽位');
                        }
                        gzRebel.djDone = true;
                        gzRefreshUi();
                        return;
                    }
                    // 槽里是空的 / 黄盖 / 已刷完 → 正常写。若当前武将正好就是槽里那个不能用的，先换一个
                    if (id === slotId) {
                        var alt = gzPickUnfinished(slotId, gzRebel.djPick);
                        if (!(alt > 0)) {
                            gzWarn('点将槽里的「' + gzGeneralNameById(slotId) +
                                '」不能用或已刷完，暂时挑不出替代武将，下一步重新挑');
                            gzRebel.generalId = 0;
                            gzRebel.djDone = false;
                            return;
                        }
                        id = alt;
                        gzRebel.generalId = alt;
                        gzRebel.generalName = gzGeneralNameById(alt);
                        gzLog('点将槽里的「' + gzGeneralNameById(slotId) + '」不能用或已刷完，换「' +
                            gzRebel.generalName + '」');
                    }
                }
            }
            if (!(id > 0)) { gzRebel.djDone = true; return; }
            gzRebel.djPending = true;
            gzRebel.djSeq = (gzRebel.djSeq || 0) + 1;
            var seq = gzRebel.djSeq;
            var runId = gzRebel.runId;
            // 反贼（大号）的「点将（百胜）」写的是 2 号反贼槽（小抄 Jh 的槽位）
            gzEnsureDianjiangGeneral(sc, id, gzRebel.generalName, GZ_DJ_SLOT_REBEL,
                function () { return gzAlive(gzRebel, runId); })
                .then(function (ok) {
                    if (seq !== gzRebel.djSeq) return;   // 已经进入下一轮了，丢弃过期结果
                    gzRebel.djPending = false;
                    if (!gzAlive(gzRebel, runId)) return;
                    if (ok) {
                        gzRebel.djDone = true;
                        gzLog('反贼（大号）点将完成：' + gzRebel.generalName);
                    } else {
                        gzFailRebel('点将「' + gzRebel.generalName + '」失败');
                    }
                });
        }

        function gzRebelReady(sc) {
            // 能读到自己的座位就以座位状态为准，避免把已经点好的「准备」再点一次（它是个开关）
            var info = gzWaitInfo(gzMySeat(sc));
            if (info && (info.isMaster || info.ready)) { gzRebel.readyClicked = true; return; }
            if (gzRebel.readyClicked) return;
            var btn = sc.startUI && sc.startUI.readyBtn;
            if (!btn || !gzUsable(btn)) return;
            GAME.pressButton(btn);
            gzRebel.readyClicked = true;
            gzLog('反贼（大号）：已点准备' + (info ? '' : '（读不到自己座位，本轮只点这一次）'));
        }

        /* ==================== 开关与冲突处理 ==================== */
        function gzKillXiaochaoAuto() {
            var killed = [];
            for (var i = 0; i < GZ_XC_CONFLICT_IDS.length; i++) {
                var el = document.getElementById(GZ_XC_CONFLICT_IDS[i]);
                if (!el || !el.checked) continue;
                el.checked = false;
                gzDispatchChange(el);
                killed.push(GZ_XC_CONFLICT_IDS[i]);
            }
            if (killed.length) gzLog('已自动关闭小抄自带的自动挂机/盖主速刷开关：' + killed.join('、'));
        }

        function gzStartHost() {
            if (!GAME.laya()) {
                showToast('游戏还没加载完成，稍后再开启盖主速刷', 'yellow', 4000);
                gzSyncSwitch(GZ_SW_HOST, false);
                return;
            }
            gzKillXiaochaoAuto();
            gzHost.runId += 1;
            gzHost.on = true;
            gzHost.phase = '';
            gzHost.error = '';
            gzHost.djPending = false;
            gzHost.generalId = 0;
            gzHost.delayMode = !!gzSt.waitOneMinute;
            gzHost.waitStartAt = 0;
            gzHost.delayDone = false;
            gzHost.delayNoTimerLogged = false;
            gzLog('盖主（小号）已开启：从当前房间开始速刷');
            showToast('盖主速刷（小号）已开启', 'green', 3000);
            gzRefreshUi();
        }

        function gzStartRebel() {
            if (!GAME.laya()) {
                showToast('游戏还没加载完成，稍后再开启盖主速刷', 'yellow', 4000);
                gzSyncSwitch(GZ_SW_REBEL, false);
                return;
            }
            gzKillXiaochaoAuto();
            gzRebel.runId += 1;
            gzRebel.on = true;
            gzRebel.phase = '';
            gzRebel.error = '';
            gzRebel.djPending = false;
            gzRebel.djPick = (gzSt.rebelDjMode === GZ_DJ_MODE_RANDOM || gzSt.rebelDjMode === GZ_DJ_MODE_ORDER)
                ? gzSt.rebelDjMode : GZ_DJ_MODE_OFF;
            gzRebel.djMode = gzRebel.djPick !== GZ_DJ_MODE_OFF;
            gzRebel.readyClicked = false;
            gzRebel.trusteeDone = false;
            gzRebel.cancelCount = 0;
            gzRebel.djDone = false;
            gzRebel.generalId = 0;
            gzRebel.generalName = '';
            gzRebel.achTries = 0;
            gzRebel.slotWaitAt = 0;
            gzLog('反贼（大号）已开启（' + gzDjModeLabel(gzRebel.djPick) + '）');
            showToast('盖主速刷（反贼/大号）已开启', 'green', 3000);
            gzRefreshUi();
        }

        function gzStopHost(reason) {
            gzHost.on = false;
            gzHost.runId += 1;
            gzHost.phase = '';
            gzHost.djPending = false;
            gzHost.error = '';
            gzLog('盖主（小号）已关闭' + (reason ? '（' + reason + '）' : ''));
            gzRefreshUi();
        }

        function gzStopRebel(reason) {
            gzRebel.on = false;
            gzRebel.runId += 1;
            gzRebel.phase = '';
            gzRebel.djPending = false;
            gzRebel.achBusy = false;
            gzRebel.error = '';
            gzLog('反贼（大号）已关闭' + (reason ? '（' + reason + '）' : ''));
            gzRefreshUi();
        }

        /* ==================== UI（配置 → 游戏辅助） ==================== */
        var gzSt = {
            rebelDjMode: GZ_DJ_MODE_OFF,   // 只持久化子开关：点将模式（off/random/order）+ 「等1分钟」
            waitOneMinute: false           // 两个主开关每次刷新都回到关闭
        };

        function gzDjModeLabel(mode) {
            if (mode === GZ_DJ_MODE_RANDOM) return '随机点将';
            if (mode === GZ_DJ_MODE_ORDER) return '按序点将';
            return '不点将';
        }

        function gzLoadSettings() {
            try {
                var d = JSON.parse(localStorage.getItem(GZ_STORAGE_KEY) || 'null');
                if (!d || typeof d !== 'object') return;
                if (typeof d.rebelDjMode === 'string' && GZ_DJ_MODES.indexOf(d.rebelDjMode) >= 0) {
                    gzSt.rebelDjMode = d.rebelDjMode;
                } else if (typeof d.rebelDj === 'boolean') {
                    // 兼容 2.2 的旧存档：开 = 随机点将，关 = 不点将
                    gzSt.rebelDjMode = d.rebelDj ? GZ_DJ_MODE_RANDOM : GZ_DJ_MODE_OFF;
                }
                if (typeof d.waitOneMinute === 'boolean') gzSt.waitOneMinute = d.waitOneMinute;
            } catch (e) {}
        }

        function gzSaveSettings() {
            try {
                localStorage.setItem(GZ_STORAGE_KEY, JSON.stringify({
                    rebelDjMode: gzSt.rebelDjMode,
                    waitOneMinute: !!gzSt.waitOneMinute
                }));
            } catch (e) {}
        }

        function gzSyncSwitch(id, checked) {
            var el = document.getElementById(id);
            if (el && el.checked !== !!checked) el.checked = !!checked;
        }

        /* --- 挂在「小抄 HUD → 配置」页里。行布局用内联样式；金色拨杆同时写小抄当前的类名
         *     和本模块自己的 xcGz2* 类名 + 一份只作用于 #xcGz2Section 的样式：
         *     小抄每次更新都会换掉随机类名（1.6.66 已全部换掉），自带样式能保证新版本上
         *     拨杆仍然是金色开关而不是裸露的 checkbox，旧版本上也不会重复显示圆点。 --- */

        function gzEnsureStyle() {
            try {
                if (!document || !document.head) return;
                if (document.getElementById('xcGz2Style')) return;
                var style = document.createElement('style');
                style.id = 'xcGz2Style';
                style.textContent = [
                    '#xcGz2Section .xcGz2Sw{position:relative;display:inline-block;flex:0 0 auto;' +
                        'width:40px;height:20px;vertical-align:middle;cursor:pointer}',
                    '#xcGz2Section .xcGz2Sw>input{position:absolute;opacity:0;width:1px;height:1px;' +
                        'margin:0;pointer-events:none}',
                    '#xcGz2Section .xcGz2Track{position:absolute;top:0;right:0;bottom:0;left:0;' +
                        'border-radius:999px;border:1px solid rgba(242,222,156,.26);' +
                        'background:linear-gradient(180deg,#221e1a 0%,#1a1613 100%);' +
                        'box-shadow:inset 0 1px 3px rgba(0,0,0,.4);' +
                        'transition:background .2s ease,border-color .2s ease}',
                    '#xcGz2Section .xcGz2Sw input:checked+.xcGz2Track{' +
                        'background:linear-gradient(180deg,#d4b56a 0%,#b8923f 100%);' +
                        'border-color:rgba(242,222,156,.55);' +
                        'box-shadow:inset 0 1px 0 rgba(255,248,210,.25),0 0 8px rgba(212,181,106,.18)}',
                    '#xcGz2Section .xcGz2Knob{position:absolute;left:2px;top:2px;width:14px;height:14px;' +
                        'border-radius:50%;background:linear-gradient(180deg,#f5e6b8 0%,#dcc98a 100%);' +
                        'box-shadow:0 1px 3px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.28);' +
                        'transition:transform .2s cubic-bezier(.4,0,.2,1)}',
                    '#xcGz2Section .xcGz2Sw input:checked~.xcGz2Knob{transform:translateX(20px);' +
                        'background:linear-gradient(180deg,#fffaf0 0%,#f2de9c 100%)}'
                ].join('\n');
                document.head.appendChild(style);
            } catch (e) {}
        }

        // 一行：左边名字 / 右边 状态字 + 拨杆（结构和类名照小抄当前格式写死）
        function gzBuildRow(opts) {
            var row = document.createElement('div');
            row.id = opts.rowId;
            row.className = 'YiJbosBSgPo';
            row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;width:100%;box-sizing:border-box;padding:3px 2px;';

            var name = document.createElement('span');
            name.className = 'LSj25x6ii';
            name.textContent = opts.label;
            if (opts.title) name.title = opts.title;
            if (opts.indent) name.style.paddingLeft = '12px';

            var right = document.createElement('span');
            right.style.cssText = 'display:flex;align-items:center;gap:6px;';

            var status = document.createElement('span');
            status.id = opts.statusId || '';
            status.textContent = '关';
            status.style.cssText = 'font-size:11px;opacity:.8;white-space:nowrap;';

            var label = document.createElement('label');
            label.className = 'F5To3O0O3b1J xcGz2Sw';
            var input = document.createElement('input');
            input.id = opts.switchId;
            input.type = 'checkbox';
            var track = document.createElement('span');
            track.className = 'hgCOVeOF4 xcGz2Track';
            var knob = document.createElement('span');
            knob.className = 'jRTciaMi xcGz2Knob';
            label.appendChild(input);
            label.appendChild(track);
            label.appendChild(knob);

            right.appendChild(status);
            right.appendChild(label);
            row.appendChild(name);
            row.appendChild(right);
            return row;
        }

        // 反贼（大号）「点将（百胜）」三选一：不点将 / 随机点将 / 按序点将。
        // 不加左侧文字（用户要求去掉），只留三个按钮；用分段按钮自绘（颜色继承宿主 HUD、
        // 选中项金色底），悬停用原生 title 显示每项说明。运行中也能点（不再置灰/禁用）。
        var GZ_DJ_OPTIONS = [
            { v: GZ_DJ_MODE_OFF, t: '不点将', tip: '不点将：不写点将槽；开局选将时按「按序点将」的排序从框里挑（技能战功已完成、百胜进度高优先），框里都刷满百胜了就随机挑一个（不选黄盖/界黄盖）。' },
            { v: GZ_DJ_MODE_RANDOM, t: '随机点将', tip: '随机点将：在所有未完成百胜战功的武将里随机轮换，逐个刷百胜。' },
            { v: GZ_DJ_MODE_ORDER, t: '按序点将', tip: '按序点将：优先技能战功已完成的武将（组内按百胜进度从多到少），再轮到技能战功未完成的，逐个刷满百胜再换下一个。' }
        ];

        function gzBuildDjRow(opts) {
            var row = document.createElement('div');
            row.id = opts.rowId;
            row.className = 'YiJbosBSgPo';
            row.style.cssText = 'display:flex;align-items:center;justify-content:flex-start;width:100%;' +
                'box-sizing:border-box;padding:3px 2px;' + (opts.indent ? 'padding-left:12px;' : '');

            var seg = document.createElement('span');
            seg.id = opts.segId;
            seg.style.cssText = 'display:inline-flex;flex:0 0 auto;border:1px solid currentColor;' +
                'border-radius:6px;overflow:hidden;';
            for (var i = 0; i < GZ_DJ_OPTIONS.length; i++) {
                var b = document.createElement('button');
                b.type = 'button';
                b.className = 'xcGz2DjOpt';
                b.setAttribute('data-mode', GZ_DJ_OPTIONS[i].v);
                b.title = GZ_DJ_OPTIONS[i].tip;
                b.textContent = GZ_DJ_OPTIONS[i].t;
                b.style.cssText = 'padding:2px 7px;font:inherit;font-size:11px;line-height:16px;' +
                    'border:0;background:transparent;color:inherit;white-space:nowrap;cursor:pointer;';
                seg.appendChild(b);
            }

            row.appendChild(seg);
            return row;
        }

        function gzBuildSection() {
            var section = document.createElement('div');
            section.id = GZ_SECTION_ID;
            section.className = 'mgLjrxp';

            var title = document.createElement('h4');
            title.className = 'IelWgpKFA03';
            title.textContent = '盖主速刷';

            var list = document.createElement('div');
            list.className = 'o3JWMCed9rFp';
            list.appendChild(gzBuildRow({
                rowId: GZ_ROW_HOST, label: '盖主（小号）',
                switchId: GZ_SW_HOST, statusId: GZ_ST_HOST
            }));
            list.appendChild(gzBuildRow({
                rowId: GZ_ROW_WAIT, label: '等1分钟', indent: true,
                switchId: GZ_SW_WAIT, statusId: GZ_ST_WAIT,
                title: '开启后，盖主（小号）会烧条：出牌倒计时剩 3 秒才点苦肉，' +
                    '让每局拖到约 1 分钟；本局满 45 秒后取消延迟，立刻苦肉收尾。'
            }));
            list.appendChild(gzBuildRow({
                rowId: GZ_ROW_REBEL, label: '反贼（大号）',
                switchId: GZ_SW_REBEL, statusId: GZ_ST_REBEL
            }));
            list.appendChild(gzBuildDjRow({
                rowId: GZ_ROW_DJ, segId: GZ_SEG_DJ, indent: true
            }));

            section.appendChild(title);
            section.appendChild(list);
            return section;
        }

        // 找「小抄 HUD → 配置」页的内容容器：①「游戏辅助」标题所在区块 ②「配置」按钮后面那块。
        // （只用这两处——和当年不闪的那版一致；不再往工具页按钮组那种会被频繁重绘的地方塞。）
        function gzFindConfigPane() {
            var heads = document.querySelectorAll('h4');
            for (var i = 0; i < heads.length; i++) {
                if (gzTrim(heads[i].textContent) !== '游戏辅助') continue;
                var section = heads[i].parentElement;
                if (section && section.parentElement) return section.parentElement;
            }
            var btns = document.querySelectorAll('button');
            for (var j = 0; j < btns.length; j++) {
                if (gzTrim(btns[j].textContent) !== '配置' || !btns[j].nextElementSibling) continue;
                var pane = btns[j].nextElementSibling;
                var head = pane.querySelector ? pane.querySelector('h4') : null;
                if (head && head.parentElement && head.parentElement.parentElement) return head.parentElement.parentElement;
                return pane;
            }
            return null;
        }

        // 只建一次节点，之后只做「重新挂上去」；挂载检查最多 1 秒一次。
        // 之前每拍（250ms）都判断 + 重建，节点被小抄重绘掉时就会闪个不停。
        var gzUi = { box: null, at: 0 };

        function gzNodeAttached(node) {
            if (!node) return false;
            try { if (node.isConnected === true) return true; } catch (e) {}
            try { return !!node.parentNode; } catch (e) { return false; }
        }

        function gzMountSection(pane) {
            var box = gzUi.box || document.getElementById(GZ_SECTION_ID);
            if (!box) box = gzBuildSection();
            gzUi.box = box;
            if (box.parentNode && box.parentNode !== pane) {
                try { box.parentNode.removeChild(box); } catch (e) {}
            }
            if (box.parentNode !== pane) {
                try { pane.appendChild(box); } catch (e) {}
            }
            gzBindUi();
            gzRefreshUi();
        }

        function gzEnsureMounted() {
            if (!document.body && !document.documentElement) return;
            gzEnsureStyle();
            var now = Date.now();
            if (now - (gzUi.at || 0) < 1000) return;      // 最多 1 秒检查一次，别每拍折腾 DOM
            gzUi.at = now;
            if (!gzUi.box) gzUi.box = document.getElementById(GZ_SECTION_ID);
            if (gzNodeAttached(gzUi.box)) return;         // 还挂在页面上就不动它
            var pane = gzFindConfigPane();
            if (!pane) return;
            gzMountSection(pane);
        }
        function gzBindUi() {
            var h = document.getElementById(GZ_SW_HOST);
            if (h && !h.__xcGzBound) {
                h.__xcGzBound = true;
                h.onchange = function () {
                    if (this.checked) gzStartHost(); else gzStopHost('手动关闭');
                };
            }
            var r = document.getElementById(GZ_SW_REBEL);
            if (r && !r.__xcGzBound) {
                r.__xcGzBound = true;
                r.onchange = function () {
                    if (this.checked) gzStartRebel(); else gzStopRebel('手动关闭');
                };
            }
            var w = document.getElementById(GZ_SW_WAIT);
            if (w && !w.__xcGzBound) {
                w.__xcGzBound = true;
                w.onchange = function () {
                    gzSt.waitOneMinute = !!this.checked;
                    gzSaveSettings();
                    // 运行中也能切：下一拍 gzStepHostGame 就按新状态走
                    gzHost.delayMode = !!gzSt.waitOneMinute;
                    gzLog('「等1分钟」' + (gzSt.waitOneMinute
                        ? '已开启：烧条到倒计时剩 ' + GZ_WAIT_LEFT_SEC + ' 秒再苦肉，本局满 ' +
                          Math.round(GZ_WAIT_DELAY_MS / 1000) + ' 秒后取消延迟'
                        : '已关闭'));
                    gzRefreshUi();
                };
            }
            var seg = document.getElementById(GZ_SEG_DJ);
            if (seg && !seg.__xcGzBound) {
                seg.__xcGzBound = true;
                seg.addEventListener('click', function (ev) {
                    var t = ev && ev.target;
                    var m = (t && t.getAttribute) ? t.getAttribute('data-mode') : '';
                    if (GZ_DJ_MODES.indexOf(m) < 0) return;     // 点到的不是三个选项之一
                    if (gzSt.rebelDjMode === m) return;
                    gzSt.rebelDjMode = m;
                    gzSaveSettings();
                    // 运行中也能切：立刻作用到当前这轮（本局打完 / 下一次选将起按新模式走）
                    if (gzRebel.on) {
                        gzRebel.djPick = m;
                        gzRebel.djMode = m !== GZ_DJ_MODE_OFF;
                    }
                    gzLog('反贼点将（百胜）模式：' + gzDjModeLabel(m) + (gzRebel.on ? '（运行中已切换）' : ''));
                    gzRefreshUi();
                });
            }
        }

        function gzRefreshUi() {
            var h = document.getElementById(GZ_SW_HOST);
            var hs = document.getElementById(GZ_ST_HOST);
            if (h) h.checked = !!gzHost.on;
            if (hs) {
                // 只在文字/颜色真的变了才写 DOM，别每拍都改（改了也白闪一下）
                var ht, hc;
                if (gzHost.on) { ht = '运行中'; hc = '#7FD48A'; }
                else if (gzHost.error) { ht = '已停止：' + gzHost.error; hc = '#FF8A80'; }
                else { ht = '关'; hc = ''; }
                if (hs.textContent !== ht) hs.textContent = ht;
                if (hs.style.color !== hc) hs.style.color = hc;
            }
            // 「等1分钟」：显示当前是烧条中 / 已取消延迟 / 只开了但盖主没跑
            var w = document.getElementById(GZ_SW_WAIT);
            var ws = document.getElementById(GZ_ST_WAIT);
            if (w) w.checked = !!gzSt.waitOneMinute;
            if (ws) {
                var wt, wc;
                if (!gzSt.waitOneMinute) { wt = '关'; wc = ''; }
                else if (gzHost.on && gzHost.delayMode && gzHost.delayDone) { wt = '已取消延迟'; wc = '#7FD48A'; }
                else if (gzHost.on && gzHost.delayMode && gzHost.waitStartAt) { wt = '烧条中'; wc = '#7FD48A'; }
                else { wt = '开'; wc = ''; }
                if (ws.textContent !== wt) ws.textContent = wt;
                if (ws.style.color !== wc) ws.style.color = wc;
            }
            var r = document.getElementById(GZ_SW_REBEL);
            var rs = document.getElementById(GZ_ST_REBEL);
            if (r) r.checked = !!gzRebel.on;
            if (rs) {
                var rt, rc;
                if (gzRebel.on) {
                    rt = '运行中｜' + gzDjModeLabel(gzRebel.djPick) +
                        (gzRebel.djMode && gzRebel.generalName ? '：' + gzRebel.generalName : '');
                    rc = '#7FD48A';
                } else if (gzRebel.error) {
                    rt = '已停止：' + gzRebel.error;
                    rc = '#FF8A80';
                } else {
                    rt = '关';
                    rc = '';
                }
                if (rs.textContent !== rt) rs.textContent = rt;
                if (rs.style.color !== rc) rs.style.color = rc;
            }
            // 「点将（百胜）」三选一：选中项金色高亮；运行中也能点（不再置灰/禁用）
            var seg = document.getElementById(GZ_SEG_DJ);
            if (seg) {
                var kids = seg.children || [];
                for (var i = 0; i < kids.length; i++) {
                    var btn = kids[i];
                    if (!btn || !btn.getAttribute) continue;
                    var on = btn.getAttribute('data-mode') === gzSt.rebelDjMode;
                    var bg = on ? 'rgba(240,200,90,.95)' : 'transparent';
                    var fg = on ? '#333333' : 'inherit';
                    var fw = on ? '600' : '400';
                    if (btn.style.background !== bg) btn.style.background = bg;
                    if (btn.style.color !== fg) btn.style.color = fg;
                    if (btn.style.fontWeight !== fw) btn.style.fontWeight = fw;
                    if (btn.disabled) btn.disabled = false;
                }
            }
        }

        /* ==================== 主循环 ==================== */
        // 旧版独立脚本「盖主速刷」还在跑的话，页面上会多出一块一样的 UI（它写的是 xcExtGz* 那套 id）。
        // 本模块现在用 xcGz2*，两边不会再互写同一批元素；这里只提示一次，让玩家把旧脚本删掉。
        var gzLegacyWarned = false;
        function gzDetectLegacyScript() {
            if (gzLegacyWarned) return;
            var legacy = null;
            try { legacy = document.getElementById(GZ_LEGACY_SECTION_ID); } catch (e) { legacy = null; }
            if (!legacy) return;
            gzLegacyWarned = true;
            gzWarn('检测到旧版独立脚本「盖主速刷」的 UI 还在页面上（id ' + GZ_LEGACY_SECTION_ID +
                '）。功能已并入本拓展，请在油猴里删掉/停用旧的「盖主速刷」脚本，否则会有两块 UI 一起刷新。');
            try { showToast('旧的「盖主速刷」独立脚本还在运行，请删掉它（已并入小抄的拓展）', 'yellow', 8000); } catch (e) {}
        }

        // 0=还没启动；1=本环境在跑；2=页面主环境已有一份（当前副本不再启动）
        var gzBootState = 0;

        function gzPageCopyActive() {
            try {
                var d = document.documentElement;
                return !!(d && d.getAttribute('data-xc-gz') === '1');
            } catch (e) { return false; }
        }

        // 给外层的「屏幕常亮」用：DOM 属性两个油猴环境都能读到
        function gzMarkActive() {
            try {
                var d = document.documentElement;
                if (!d) return;
                var on = !!(gzHost.on || gzRebel.on);
                if (on && d.getAttribute('data-xc-gz-active') !== '1') d.setAttribute('data-xc-gz-active', '1');
                else if (!on && d.getAttribute('data-xc-gz-active') === '1') d.removeAttribute('data-xc-gz-active');
            } catch (e) {}
        }

        /* ==================== iPad：百胜战功窗口打不开时的备用面板 ==================== */
        // 这个工厂函数会被 toString() 注入页面主环境，必须自包含：不能引用外层
        // xcIsTouchDevice；这里单独实现一份。
        function gzIsTouch() {
            try {
                var ua = String((typeof navigator !== 'undefined' && navigator.userAgent) || '');
                if (/(Windows|Win32|Win64|WOW64|Linux|CrOS)/i.test(ua) && !/Android/i.test(ua)) return false;
                if (/iPad|iPhone|iPod|Android|Mobile/i.test(ua)) return true;
                var mt = (typeof navigator !== 'undefined' && navigator.maxTouchPoints) || 0;
                if (mt > 1 && /Macintosh/i.test(ua)) return true;
                if (mt > 0) {
                    try {
                        if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return true;
                    } catch (e) {}
                }
            } catch (e) {}
            return false;
        }

        function gzBaiShengBtn() {
            try {
                var el = document.getElementById('NgC2OfZaC');
                if (el) return el;
                var btns = document.querySelectorAll('button');
                for (var i = 0; i < btns.length; i++) {
                    if (gzTrim(btns[i].textContent) === '百胜战功') return btns[i];
                }
            } catch (e) {}
            return null;
        }

        function gzBaiShengDiag() {
            var mgr = null, defs = null, nick = '';
            try { mgr = GAME.klass('AchievementManager'); } catch (e) {}
            try { defs = gzAchDefs(); } catch (e) {}
            try { nick = gzNickname(); } catch (e) {}
            return 'AchievementManager：' + (mgr
                ? (typeof mgr.sendGetAchInfo === 'function' ? '已找到' : '没有 sendGetAchInfo')
                : '找不到') +
                '\nAch 配置：' + (defs && defs.length ? defs.length + ' 条' : '未读到') +
                '\n昵称：' + (nick || '空');
        }

        function gzShowBaiShengPanel(snapshot, message) {
            var ev = gzAchEvaluate(snapshot);
            var hasData = !!(ev && ev.details);
            var skill = snapshot ? gzAchSkillCompleted(snapshot) : {};
            var ids = hasData ? Object.keys(ev.details).map(function (k) { return Number(k); }) : [];
            if (ids.length) {
                ids.sort(function (a, b) {
                    var da = ev.details[a], db = ev.details[b];
                    if (!!da.completed !== !!db.completed) return da.completed ? 1 : -1;
                    var pa = da.required ? da.progress / da.required : 0;
                    var pb = db.required ? db.progress / db.required : 0;
                    if (pb !== pa) return pb - pa;
                    return String(da.name).localeCompare(String(db.name), 'zh');
                });
            }
            var old = document.getElementById('xcExtBaiShengPanel');
            if (old && old.parentNode) old.parentNode.removeChild(old);
            var host = document.body || document.documentElement;
            if (!host) return;
            var overlay = document.createElement('div');
            overlay.id = 'xcExtBaiShengPanel';
            overlay.setAttribute('data-xc-ext', 'baisheng-panel');
            overlay.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483646;' +
                'display:flex;align-items:center;justify-content:center;padding:14px;box-sizing:border-box;' +
                'background:rgba(0,0,0,.66);font:13px/1.5 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;';
            var card = document.createElement('div');
            card.style.cssText = 'width:min(94vw,560px);max-height:86vh;display:flex;flex-direction:column;' +
                'box-sizing:border-box;background:#1d1a16;border:1px solid rgba(242,222,156,.45);' +
                'border-radius:12px;padding:14px;color:#f2de9c;box-shadow:0 12px 40px rgba(0,0,0,.55);';
            var title = document.createElement('div');
            title.style.cssText = 'font-size:16px;font-weight:700;margin:0 0 4px';
            title.textContent = '百胜战功（拓展面板）';
            var note = document.createElement('div');
            note.style.cssText = 'font-size:11px;line-height:1.6;color:#a99572;margin:0 0 8px;white-space:pre-line';
            note.textContent = ids.length
                ? '共 ' + ids.length + ' 名武将；未完成优先、按百胜进度排序。'
                : '原版窗口在移动端打不开时，由拓展直接从战功数据生成。';
            var list = document.createElement('div');
            list.style.cssText = 'flex:1 1 auto;overflow:auto;-webkit-overflow-scrolling:touch;' +
                'border-top:1px solid rgba(242,222,156,.18);border-bottom:1px solid rgba(242,222,156,.18);';
            if (!ids.length) {
                var empty = document.createElement('div');
                empty.style.cssText = 'padding:18px 8px;line-height:1.75;color:#e7d9b0;white-space:pre-line;text-align:center';
                empty.textContent = message || '正在获取百胜战功数据…';
                list.appendChild(empty);
            }
            for (var i = 0; i < ids.length; i++) {
                var d = ev.details[ids[i]];
                var row = document.createElement('div');
                row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:7px 4px;' +
                    'border-bottom:1px solid rgba(242,222,156,.08);' +
                    (d.completed ? 'color:#9fdc8f;' : 'color:#f2de9c;');
                var nm = document.createElement('span');
                nm.style.cssText = 'flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
                nm.textContent = String(d.name || ids[i]);
                var pr = document.createElement('span');
                pr.style.cssText = 'flex:0 0 auto;font-variant-numeric:tabular-nums;font-size:12px';
                pr.textContent = d.completed ? '已完成' : (d.progress + '/' + d.required);
                var sk = document.createElement('span');
                sk.style.cssText = 'flex:0 0 auto;font-size:11px;color:' + (skill[ids[i]] ? '#9fdc8f' : '#a99572');
                sk.textContent = skill[ids[i]] ? '技能✔' : '技能—';
                row.appendChild(nm);
                row.appendChild(sk);
                row.appendChild(pr);
                list.appendChild(row);
            }
            var bar = document.createElement('div');
            bar.style.cssText = 'display:flex;gap:10px;margin-top:12px';
            var refresh = document.createElement('button');
            refresh.type = 'button';
            refresh.textContent = '刷新';
            refresh.style.cssText = 'flex:1 1 0;min-height:38px;border-radius:8px;border:1px solid rgba(242,222,156,.4);' +
                'background:rgba(52,47,40,.9);color:#f2de9c;font-size:14px;cursor:pointer;';
            refresh.addEventListener('click', function (ev2) {
                ev2.preventDefault(); ev2.stopPropagation();
                gzBaiShengRefresh();
            });
            var close = document.createElement('button');
            close.type = 'button';
            close.textContent = '关闭';
            close.style.cssText = 'flex:1 1 0;min-height:38px;border-radius:8px;border:1px solid rgba(242,222,156,.7);' +
                'background:linear-gradient(180deg,#d4b56a,#b8923f);color:#2a2010;font-size:14px;font-weight:600;cursor:pointer;';
            close.addEventListener('click', function (ev2) {
                ev2.preventDefault(); ev2.stopPropagation();
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            });
            overlay.addEventListener('click', function (ev2) {
                if (ev2.target === overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
            });
            bar.appendChild(refresh);
            bar.appendChild(close);
            card.appendChild(title);
            card.appendChild(note);
            card.appendChild(list);
            card.appendChild(bar);
            overlay.appendChild(card);
            host.appendChild(overlay);
        }

        function gzBaiShengRefresh() {
            gzShowBaiShengPanel(null, '正在刷新百胜战功数据…');
            gzAchQuery('statistics').then(function (snap) {
                if (snap) { gzShowBaiShengPanel(snap); return; }
                var diag = '';
                try { diag = gzBaiShengDiag(); } catch (e) {}
                gzShowBaiShengPanel(null,
                    '百胜战功数据没拿到（可以点「刷新」重试）。\n\n' + diag);
            });
        }

        function gzBaiShengOpen() {
            var snap = gzAch.snapshot;
            if (snap) gzShowBaiShengPanel(snap);
            else gzShowBaiShengPanel(null, '正在获取百胜战功数据…');
            gzAchQuery('statistics').then(function (s) {
                if (s) { gzShowBaiShengPanel(s); return; }
                if (!snap) {
                    var diag = '';
                    try { diag = gzBaiShengDiag(); } catch (e) {}
                    gzShowBaiShengPanel(null,
                        '百胜战功数据没拿到（可以点「刷新」重试）。\n\n' + diag);
                }
            });
        }

        // 移动端直接接管「百胜战功」：原版窗口要等 AchievementManager 回包才创建，
        // iPad 上这一步经常卡住，而其他工具（自助观星/战绩出框/皮肤收集）不查数据所以能开。
        // 这里在捕获阶段拦下点击，不再调用原版失败的处理函数，直接用拓展自己的数据面板。
        function gzInstallBaiShengTouchFix() {
            if (!gzIsTouch() || document.__xcBaiShengTouchFix) return;
            document.__xcBaiShengTouchFix = true;
            document.addEventListener('click', function (e) {
                var btn = null;
                try {
                    btn = e.target && e.target.closest ? e.target.closest('#NgC2OfZaC,button') : null;
                } catch (e2) { btn = null; }
                if (!btn) return;
                if (btn.id !== 'NgC2OfZaC' && gzTrim(btn.textContent) !== '百胜战功') return;
                try {
                    e.preventDefault();
                    e.stopPropagation();
                    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
                } catch (e3) {}
                gzBaiShengOpen();
            }, true);
        }

        function tick() {
            if (gzBootState !== 1) return;
            gzEnsureEventHook();
            try { gzInstallBaiShengTouchFix(); } catch (e) {}
            gzEnsureMounted();
            try { if (gzHost.on) gzStepHost(); } catch (e) { gzWarn('盖主流程异常', e); }
            try { if (gzRebel.on) gzStepRebel(); } catch (e) { gzWarn('反贼流程异常', e); }
            gzRefreshUi();
            gzMarkActive();
        }

        function bootReal() {
            gzLoadSettings();
            gzEnsureStyle();
            gzDetectLegacyScript();
            try { gzInstallBaiShengTouchFix(); } catch (e) {}
            gzEnsureEventHook();
            gzEnsureMounted();
            [200, 800, 2000, 5000].forEach(function (t) {
                setTimeout(function () {
                    try { gzDetectLegacyScript(); } catch (e) {}
                    try { gzEnsureMounted(); } catch (e) {}
                }, t);
            });
            // 自己起一个 500ms 主心跳：拓展原有的 reinstallAll 是 3 秒一轮，
            // 对「苦肉 / 点取消 / 选将」这类要及时响应的操作太慢。
            if (!gzTimer) {
                gzTimer = setInterval(function () {
                    try { tick(); } catch (e) { gzWarn('主循环异常', e); }
                }, GZ_TICK_MS);
            }
            gzLog('盖主速刷已就绪：小抄 → 配置 → 游戏辅助（最底下「盖主速刷」）');
        }

        // fromPageWorld：由隔离世界兼容层注入页面主环境的副本调用，直接启动
        function boot(fromPageWorld) {
            if (gzBootState) return;
            if (fromPageWorld) { gzBootState = 1; bootReal(); return; }
            var t0 = Date.now();
            (function waitInjection() {
                if (gzBootState) return;
                if (gzPageCopyActive()) {
                    gzBootState = 2;
                    console.log(TAG, '[iPad兼容] 页面主环境已有一份「盖主速刷」在跑，当前环境不再重复启动');
                    return;
                }
                var inject = null;
                try {
                    inject = document.documentElement && document.documentElement.getAttribute('data-xc-gz-inject');
                } catch (e) {}
                if (inject === 'pending' && Date.now() - t0 < 6000) { setTimeout(waitInjection, 150); return; }
                // 页面主环境还没判定完（隔离世界要等 <html> 出现才能注入），先别启动本副本
                try {
                    if (XC_PAGE_STATE && XC_PAGE_STATE.world === null && Date.now() - t0 < 2000) {
                        setTimeout(waitInjection, 150);
                        return;
                    }
                } catch (e) {}
                gzBootState = 1;
                bootReal();
            })();
        }

        return { boot: boot, tick: tick, baiShengOpen: gzBaiShengOpen };
        })();
        return gzModule;
    };
    var xcGaiZhu = xcGaiZhuInit();
    // 百胜战功的移动端接管要尽早可用（盖主速刷的 boot 可能要等页面主环境注入）。
    // 隔离世界看不到页面主环境赋的值时，页面主环境里那份 gaizhu 自己的监听会兜底。
    try { window.__xcExtBaiShengOpen = xcGaiZhu.baiShengOpen; } catch (e) {}
    // iPad/隔离世界：先探测页面主环境，必要时把钩子与「盖主速刷」注入进去
    try { xcEnsurePageWorld(); } catch (e) { console.warn(TAG, '[iPad兼容] 页面主环境探测失败：', e); }
    // 可选：内置小抄（移动端默认开；PC 默认关，开启后从官方自动更新并注入页面主环境）
    try { xcEmbedBootstrap(); } catch (e) { console.warn(TAG, '[内置小抄] 启动失败：', e); }
    setTimeout(function () {
        if (xcIsTouchDevice()) return;   // 移动端的内置小抄检查在 xcEmbedBootstrap 里
        try { xcUpdateBackgroundCheck(false); } catch (e) {}
    }, 12000);
    xcGaiZhu.boot();

    // ============ 13.5 iPad / 触屏：自动玩法运行时申请屏幕常亮 ============
    // iPad 锁屏/息屏会暂停页面计时器，挂机玩法会停摆；Screen Wake Lock 可以让屏幕保持点亮。
    // 只在「秒杀连点」或「盖主速刷」开着时申请，关了立即释放（系统不支持时静默跳过）。
    var xcMobile = (function () {
        var lock = null, want = false, warned = false, lastFail = 0;
        function supported() {
            try { return !!(navigator.wakeLock && typeof navigator.wakeLock.request === 'function'); }
            catch (e) { return false; }
        }
        function release() {
            if (!lock) return;
            try { lock.release(); } catch (e) {}
            lock = null;
        }
        function request() {
            if (!want || lock || !supported()) return;
            if (lastFail && Date.now() - lastFail < 30000) return;   // 失败了先歇 30 秒，别每 3 秒骚扰一次
            try { if (document.visibilityState && document.visibilityState !== 'visible') return; } catch (e) {}
            try {
                navigator.wakeLock.request('screen').then(function (l) {
                    lock = l;
                    lastFail = 0;
                    try { l.addEventListener('release', function () { lock = null; }); } catch (e) {}
                }).catch(function (e) {
                    lastFail = Date.now();
                    if (!warned) {
                        warned = true;
                        console.debug(TAG, '[iPad] 屏幕常亮申请失败：', (e && e.message) || e);
                    }
                });
            } catch (e) { lastFail = Date.now(); }
        }
        function sync(on) {
            want = !!on;
            if (!want) { release(); return; }
            request();
        }
        try {
            document.addEventListener('visibilitychange', function () {
                try { if (document.visibilityState === 'visible' && want && !lock) request(); } catch (e) {}
            });
        } catch (e) {}
        return { sync: sync };
    })();

    function xcAnyAutomationOn() {
        try { if (skState.enabled === true) return true; } catch (e) {}
        // 盖主速刷可能跑在页面主环境（隔离世界注入副本），状态从 DOM 属性读
        try {
            var d = document.documentElement;
            if (d && d.getAttribute('data-xc-gz-active') === '1') return true;
        } catch (e) {}
        return false;
    }

    // ============ 13.6 iPad / 隔离世界诊断（只打日志，不改行为） ============
    // 原版小抄初始化时等待的 PC 客户端接口（缺任意一个都会「等待游戏运行时初始化超时」）
    function xcLastErrorText() {
        var t = '';
        try { t = xcPageAttr('data-xc-last-error') || ''; } catch (e) {}
        if (!t) {
            try {
                var noise = xcPageAttr('data-xc-last-noise') || '';
                if (noise) t = noise + '（可能是游戏自动播放/权限提示，非小抄）';
            } catch (e) {}
        }
        if (!t) {
            try {
                if (window.__xcExtErrors && window.__xcExtErrors.length) {
                    t = window.__xcExtErrors[window.__xcExtErrors.length - 1];
                }
            } catch (e) {}
        }
        return String(t || '');
    }

    function xcLastErrorList() {
        var list = '';
        try { list = xcPageAttr('data-xc-errors') || ''; } catch (e) {}
        if (!list) {
            try { if (window.__xcExtErrors) list = window.__xcExtErrors.join('\n'); } catch (e) {}
        }
        return String(list || '');
    }

    // 原版小抄如果带 @grant/unsafeWindow 被油猴放进沙箱，页面主环境的变量它看不到，
    // 「小抄的拓展」这边能读到 Uc1cryZVg / VIiR0YfvE4s 才是同一个世界。
    function xcSandboxHintText() {
        try {
            var uc = xcPageAttr('data-xc-uc');
            var vi = xcPageAttr('data-xc-vi');
            var tipSeen = xcPageAttr('data-xc-xc-tip-seen');
            if (tipSeen === '1' || (uc === '0' && vi === '0')) {
                return '⚠ 已安装原版小抄但页面变量 Uc/VI 读不到：它多半被油猴放进了沙箱。' +
                    '请改用「小抄-1.6.66-iPad页面版.user.js」，或在油猴里把原版小抄切到页面主环境；' +
                    '也可以点下面「启用内置小抄」，由拓展自动从官方更新并注入（移动端没有缓存时会自动弹窗提示，无需外部镜像）。';
            }
        } catch (e) {}
        return '';
    }

    function xcEmbedStatusText() {
        try {
            if (!xcEmbedFlag()) return '关';
            if (xcEmbedState.error) return '错误：' + xcEmbedState.error;
            if (xcEmbedState.injected) {
                var s = '已注入 v' + xcEmbedState.injected;
                if (xcEmbedState.latest && xcEmbedState.latest !== xcEmbedState.injected) {
                    s += '（最新 v' + xcEmbedState.latest + '，刷新后更新）';
                }
                return s;
            }
            if (xcEmbedState.downloading) return '下载中…';
            if (xcEmbedState.cached) return '已启用，缓存 v' + xcEmbedState.cached + '（等待注入）';
            return '已启用，等待下载';
        } catch (e) { return '未知'; }
    }

    function xcLegacyGate() {
        var out = { bgDiv: false, systemContext: false, jsZip: false, ctr: false, laya: false };
        try { out.bgDiv = !!document.getElementById('bgDiv'); } catch (e) {}
        try { out.systemContext = typeof window.SystemContext !== 'undefined'; } catch (e) {}
        try { out.jsZip = typeof window.JSZipUtils !== 'undefined'; } catch (e) {}
        try {
            out.ctr = !!(window.CtrUtil && window.CtrUtil.Ctr &&
                typeof window.CtrUtil.Ctr.Ofb_Dec !== 'undefined');
        } catch (e) {}
        try { out.laya = !!window.Laya; } catch (e) {}
        return out;
    }

    function xcDiagnose() {
        var info = {
            ua: (function () { try { return navigator.userAgent; } catch (e) { return ''; } })(),
            touch: (function () {
                try { return ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0; }
                catch (e) { return false; }
            })(),
            world: XC_PAGE_STATE.world === null ? 'unknown'
                : (XC_PAGE_STATE.world === 'page' ? 'page(页面主环境)'
                    : (XC_PAGE_STATE.world === 'isolated' ? 'isolated(隔离世界)' : 'unknown(注入失败)')),
            pageHooks: xcPageAttr('data-xc-page'),
            gzPage: xcPageAttr('data-xc-gz'),
            shim: xcPageAttr('data-xc-shim'),
            lastError: '',
            gate: null,
            uc1: false, vi: false, laya: false
        };
        try { info.uc1 = !!window.Uc1cryZVg; } catch (e) {}
        try { info.vi = !!window.VIiR0YfvE4s; } catch (e) {}
        try { info.laya = !!window.Laya; } catch (e) {}
        try { info.gate = xcLegacyGate(); } catch (e) {}
        try { info.lastError = xcLastErrorText(); } catch (e) {}
        console.log(TAG, '[iPad/兼容诊断]', info);
        if (XC_PAGE_STATE.world === 'isolated' && info.gzPage !== '1') {
            console.warn(TAG, '[iPad/兼容诊断] 当前油猴运行在隔离世界：读不到页面里的 Laya / 小抄变量，' +
                '「盖主速刷」需要页面主环境。请把本脚本切到「页面上下文 / MAIN world」运行（Stay 等可在扩展设置里改）。' +
                '网络拦截、秒杀连点、95折充值、界面类功能不受影响。');
        }
        try {
            if (!xcXiaochaoHudPresent() && info.gate) {
                var miss = [];
                if (!info.gate.bgDiv) miss.push('bgDiv');
                if (!info.gate.systemContext) miss.push('SystemContext');
                if (!info.gate.jsZip) miss.push('JSZipUtils');
                if (!info.gate.ctr) miss.push('CtrUtil.Ctr.Ofb_Dec');
                if (miss.length) {
                    console.warn(TAG, '[iPad/兼容诊断] 没看到小抄 HUD；原版小抄初始化还在等 PC 客户端接口：缺 ' +
                        miss.join(' / ') + '。' +
                        (info.shim ? ('已在页面主环境补齐：' + info.shim)
                            : '页面主环境注入没生效，没能补齐（检查 CSP / 油猴注入设置）'));
                }
            }
        } catch (e) {}
    }
    setTimeout(function () { try { xcDiagnose(); } catch (e) {} }, 8000);

    // ============ 13.7 iPad / 触屏：小抄 HUD 没出现时弹一张可见的自检卡片 ============
    // 常见情况：油猴根本没注入（权限/框架）、只装了拓展没装原版小抄、或者注入了错误的世界。
    // 这时控制台也没有玩家看得懂的东西，所以在触屏设备上检测不到小抄 HUD 时给一张卡片：
    // 显示当前 URL / 油猴管理器 / 注入状态 / 页面变量可见性，可一键复制，HUD 出现后自动收起。
    function xcNormText(s) {
        return String(s == null ? '' : s).replace(/\s+/g, '');
    }

    function xcXiaochaoHudPresent() {
        try {
            var btns = document.querySelectorAll('button');
            for (var i = 0; i < btns.length; i++) {
                var t = xcNormText(btns[i].textContent);
                if (t === '检测更新' || t === '配置') return true;
            }
            var h4s = document.querySelectorAll('h4');
            for (var j = 0; j < h4s.length; j++) {
                if (xcNormText(h4s[j].textContent) === '游戏辅助') return true;
            }
            if (document.getElementById('xcExtSeckillAutoBuy')) return true;   // 秒杀面板是我们挂进 HUD 的
        } catch (e) {}
        return false;
    }

    // 登录页/大厅页不算游戏页；只有游戏页上才提示，避免在登录页误报
    function xcLooksLikeGamePage() {
        try {
            if (document.querySelector('canvas')) return true;
            if (window.Laya) return true;
            if (/\/yxsgs\/|\/kwsgsn\/|\/220\/|\/game\//.test(String(location.pathname || ''))) return true;
        } catch (e) {}
        return false;
    }

    function xcDiagSnapshot() {
        function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
        var lines = [];
        lines.push('小抄的拓展 v2.6.6 · iPad 兼容自检');
        lines.push('URL: ' + safe(function () { return location.href; }, ''));
        lines.push('UA: ' + safe(function () { return navigator.userAgent; }, ''));
        lines.push('管理器: ' + safe(function () {
            if (window.GM_info) {
                var n = String(window.GM_info.scriptHandler || '');
                var v = window.GM_info.script && window.GM_info.script.version ? String(window.GM_info.script.version) : '';
                return (n || 'GM_info') + (v ? ' ' + v : '');
            }
            return '未暴露 GM_info';
        }, '未知'));
        lines.push('iframe: ' + safe(function () { return window.top === window ? '否' : '是'; }, '未知'));
        lines.push('世界: ' + (XC_PAGE_STATE.world || '未知'));
        lines.push('data-xc-page: ' + String(xcPageAttr('data-xc-page')));
        lines.push('data-xc-gz: ' + String(xcPageAttr('data-xc-gz')));
        lines.push('data-xc-shim: ' + String(xcPageAttr('data-xc-shim')));
        (function () {
            var g = xcLegacyGate();
            lines.push('运行时接口: bgDiv=' + (g.bgDiv ? '有' : '无') +
                ' SystemContext=' + (g.systemContext ? '有' : '无') +
                ' JSZipUtils=' + (g.jsZip ? '有' : '无') +
                ' CtrUtil=' + (g.ctr ? '有' : '无') +
                ' Laya=' + (g.laya ? '有' : '无'));
        })();
        lines.push('小抄 HUD: ' + (xcXiaochaoHudPresent() ? '有' : '无'));
        lines.push('HUD根: now=' + String(xcPageAttr('data-xc-hud-root')) + ' seen=' + String(xcPageAttr('data-xc-hud-seen')));
        lines.push('配置包 Config_w.sgs: ' + (xcPageAttr('data-xc-config-loaded') === '1' ? '已下载' : '未下载'));
        lines.push('CtrUtil: real=' + String(xcPageAttr('data-xc-ctr-real')) + ' ready=' + String(xcPageAttr('data-xc-ctr-ready')));
        lines.push('最近错误: ' + (xcLastErrorText() || '无'));
        lines.push('内置小抄: ' + xcEmbedStatusText() + ' · data-embed=' + String(xcPageAttr('data-xc-embed')));
        lines.push('错误堆栈: ' + (String(xcPageAttr('data-xc-last-stack') || '') || '无'));
        lines.push('错误列表:\n' + (xcLastErrorList() || '无'));
        lines.push('Laya: ' + safe(function () { return !!window.Laya; }, false));
        lines.push('Uc1cryZVg: ' + safe(function () { return !!window.Uc1cryZVg; }, false));
        lines.push('原版小抄世界: ' + (safe(function () { return !!(window.Uc1cryZVg || window.VIiR0YfvE4s); }, false)
            ? '与拓展同世界（页面主环境）' : '页面变量不可见（很可能被油猴放进了沙箱）'));
        lines.push('小抄初始化提示出现过: ' + String(xcPageAttr('data-xc-xc-tip-seen')));
        lines.push('沙箱提示: ' + (xcSandboxHintText() || '无'));
        lines.push('VIiR0YfvE4s: ' + safe(function () { return !!window.VIiR0YfvE4s; }, false));
        lines.push('readyState: ' + safe(function () { return document.readyState; }, ''));
        lines.push('触屏: ' + (safe(function () {
            return ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0;
        }, false) ? '是' : '否'));
        return lines.join('\n');
    }

    function xcCopyText(text, done) {
        try {
            if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
                return;
            }
        } catch (e) {}
        try {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
            (document.body || document.documentElement).appendChild(ta);
            ta.focus();
            ta.select();
            var ok = false;
            try { ok = document.execCommand('copy'); } catch (e) {}
            try { if (ta.parentNode) ta.parentNode.removeChild(ta); } catch (e) {}
            done(ok);
        } catch (e) { done(false); }
    }

    var xcDiagBadgeEl = null;
    function xcShowDiagBadge() {
        if (xcDiagBadgeEl || !(document.body || document.documentElement)) return;
        try {
            var box = document.createElement('div');
            box.id = 'xcExtDiagBadge';
            box.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:2147483647;max-width:86vw;padding:10px 12px;' +
                'border-radius:10px;background:rgba(28,24,18,.96);color:#f2de9c;' +
                'border:1px solid rgba(242,222,156,.45);box-shadow:0 6px 24px rgba(0,0,0,.5);' +
                'font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;font-size:12px;line-height:1.6;' +
                'text-align:left;pointer-events:auto;';

            var title = document.createElement('div');
            title.textContent = '小抄的拓展 v2.6.6 已运行';
            title.style.cssText = 'font-weight:700;font-size:13px;margin-bottom:4px;';

            var msg = document.createElement('div');
            msg.textContent = '但没有检测到「小抄」的界面（HUD）。';

            var tip = document.createElement('div');
            tip.style.cssText = 'margin-top:4px;color:#d8cba6;';
            tip.textContent = '请确认：① 同一个油猴里已安装并启用原版「小抄」；② 油猴允许注入页面上下文 / iframe；' +
                '③ 当前在游戏页，不是登录页。若下面有「最近错误」，说明小抄已加载但初始化失败，请点「复制诊断」反馈。';

            var hintEl = document.createElement('div');
            hintEl.style.cssText = 'margin-top:4px;color:#ffd27a;font-weight:600;';
            hintEl.textContent = xcSandboxHintText();

            var info = document.createElement('div');
            info.style.cssText = 'margin-top:6px;font-size:11px;line-height:1.5;color:#cbbf9a;word-break:break-all;';
            info.textContent = '当前页：' + (function () {
                try { return location.hostname + location.pathname; } catch (e) { return ''; }
            })() + ' · 注入：' + (XC_PAGE_STATE.world || '未知') +
                ' · Laya：' + (function () { try { return window.Laya ? '有' : '无'; } catch (e) { return '无'; } })() +
                ' · 小抄变量：' + (function () {
                    var uc = xcPageAttr('data-xc-uc');
                    var vi = xcPageAttr('data-xc-vi');
                    if (uc === null) { try { uc = window.Uc1cryZVg ? '1' : '0'; } catch (e) { uc = '0'; } }
                    if (vi === null) { try { vi = window.VIiR0YfvE4s ? '1' : '0'; } catch (e) { vi = '0'; } }
                    return (uc === '1' ? 'Uc有' : 'Uc无') + '/' + (vi === '1' ? 'VI有' : 'VI无');
                })() +
                ' · HUD根：' + (function () {
                    var now = xcPageAttr('data-xc-hud-root');
                    var seen = xcPageAttr('data-xc-hud-seen');
                    if (now === '1') return '有';
                    return seen === '1' ? '曾出现后消失' : '无';
                })() +
                ' · 配置包：' + (xcPageAttr('data-xc-config-loaded') === '1' ? '已下载' : '未下载') +
                ' · CtrUtil：' + (xcPageAttr('data-xc-ctr-ready') === '1' ? '就绪'
                    : (xcPageAttr('data-xc-ctr-real') === '1' ? '存在未就绪' : '缺失')) +
                ' · ' + (function () {
                    var g = xcLegacyGate(), miss = [];
                    if (!g.bgDiv) miss.push('bgDiv');
                    if (!g.systemContext) miss.push('SystemContext');
                    if (!g.jsZip) miss.push('JSZipUtils');
                    if (!g.ctr) miss.push('CtrUtil');
                    var shim = xcPageAttr('data-xc-shim');
                    if (shim) return '已补齐运行时：' + shim;
                    return miss.length ? ('缺运行时：' + miss.join('/')) : '运行时接口齐全';
                })() +
                ' · 内置小抄：' + xcEmbedStatusText();

            var errEl = document.createElement('div');
            errEl.style.cssText = 'margin-top:6px;font-size:11px;line-height:1.5;color:#ffb4a8;word-break:break-all;';
            errEl.textContent = '最近错误：' + (xcLastErrorText() ? xcLastErrorText().slice(0, 240) : '无');

            var bar = document.createElement('div');
            bar.style.cssText = 'margin-top:8px;display:flex;gap:8px;';

            var copy = document.createElement('button');
            copy.type = 'button';
            copy.textContent = '复制诊断';
            copy.style.cssText = 'min-height:32px;padding:0 12px;border-radius:7px;border:1px solid rgba(242,222,156,.5);' +
                'background:rgba(212,181,106,.92);color:#2a2010;font-weight:600;font-size:12px;' +
                'font-family:inherit;cursor:pointer;';
            copy.addEventListener('click', function (ev) {
                try { ev.stopPropagation(); } catch (e) {}
                xcCopyText(xcDiagSnapshot(), function (ok) {
                    copy.textContent = ok ? '已复制' : '复制失败';
                    setTimeout(function () { copy.textContent = '复制诊断'; }, 1800);
                });
            });

            var close = document.createElement('button');
            close.type = 'button';
            close.textContent = '关闭';
            close.style.cssText = 'min-height:32px;padding:0 12px;border-radius:7px;border:1px solid rgba(242,222,156,.35);' +
                'background:transparent;color:#f2de9c;font-size:12px;font-family:inherit;cursor:pointer;';
            close.addEventListener('click', function (ev) {
                try { ev.stopPropagation(); } catch (e) {}
                try { if (box.parentNode) box.parentNode.removeChild(box); } catch (e) {}
                xcDiagBadgeEl = null;
            });

            var embedBtn = document.createElement('button');
            embedBtn.type = 'button';
            embedBtn.style.cssText = 'min-height:32px;padding:0 12px;border-radius:7px;border:1px solid rgba(242,222,156,.4);' +
                'background:rgba(70,60,40,.85);color:#f2de9c;font-size:12px;font-family:inherit;cursor:pointer;';
            var embedReloadPending = false;
            function refreshEmbedBtn() {
                if (!xcEmbedFlag()) { embedBtn.textContent = '启用内置小抄'; return; }
                if (embedReloadPending) { embedBtn.textContent = '已下载，点此刷新'; return; }
                if (!xcEmbedGetVer()) { embedBtn.textContent = '下载内置小抄'; return; }
                embedBtn.textContent = '停用内置小抄';
            }
            function startEmbedDownload() {
                embedBtn.disabled = true;
                embedBtn.textContent = '下载中…';
                xcEmbedEnable().then(function (ver) {
                    embedBtn.disabled = false;
                    embedReloadPending = true;
                    embedBtn.textContent = '已下载 v' + ver + '，点此刷新';
                }).catch(function () {
                    embedBtn.disabled = false;
                    embedBtn.textContent = '下载失败（重试）';
                });
            }
            refreshEmbedBtn();
            embedBtn.addEventListener('click', function (ev) {
                try { ev.stopPropagation(); } catch (e) {}
                if (xcEmbedFlag()) {
                    if (embedReloadPending) { try { location.reload(); } catch (e) {} return; }
                    if (!xcEmbedGetVer()) { startEmbedDownload(); return; }
                    xcEmbedDisable();
                    embedReloadPending = false;
                    refreshEmbedBtn();
                    return;
                }
                var ok = false;
                try {
                    ok = window.confirm('将从 xiaochao.org 下载官方小抄并在页面中运行（等同安装原版小抄），' +
                        '之后由拓展自动检查官方更新。确定开启？');
                } catch (e) { ok = false; }
                if (!ok) return;
                startEmbedDownload();
            });

            bar.appendChild(copy);
            bar.appendChild(embedBtn);
            bar.appendChild(close);
            box.appendChild(title);
            box.appendChild(msg);
            box.appendChild(tip);
            box.appendChild(hintEl);
            box.appendChild(info);
            box.appendChild(errEl);
            box.appendChild(bar);
            (document.body || document.documentElement).appendChild(box);
            xcDiagBadgeEl = box;
            console.log(TAG, '[iPad] 未检测到小抄 HUD，已显示自检卡片');

            // HUD 后来出现（例如小抄加载慢）就自动收起
            var iv = setInterval(function () {
                if (!xcDiagBadgeEl) { clearInterval(iv); return; }
                try {
                    var nowErr = xcLastErrorText();
                    var nextErr = '最近错误：' + (nowErr ? nowErr.slice(0, 240) : '无');
                    if (errEl.textContent !== nextErr) errEl.textContent = nextErr;
                    var nextHint = xcSandboxHintText();
                    if (hintEl.textContent !== nextHint) hintEl.textContent = nextHint;
                } catch (e) {}
                if (xcXiaochaoHudPresent()) {
                    try { if (box.parentNode) box.parentNode.removeChild(box); } catch (e) {}
                    xcDiagBadgeEl = null;
                    clearInterval(iv);
                }
            }, 4000);
        } catch (e) {}
    }

    // 只在触屏设备、游戏页、且 HUD 一直没出现时提示（桌面端保持原样）
    (function xcScheduleDiagBadge() {
        var touch = false;
        try { touch = ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0; } catch (e) {}
        if (!touch) return;
        setTimeout(function () {
            var tries = 0;
            (function check() {
                if (xcXiaochaoHudPresent()) return;
                if (!xcLooksLikeGamePage()) {
                    if (++tries < 12) { setTimeout(check, 5000); return; }
                    return;
                }
                if (++tries < 4) { setTimeout(check, 5000); return; }
                xcShowDiagBadge();
            })();
        }, 10000);
    })();

    // ============ 14. 定时重装（防止被小抄或其他脚本覆盖） ============
    function reinstallAll() {
        installFetchHook();
        installXhrHook();
        installWorkerHook();
        installBeaconHook();
        installImageHook();
        installWebSocketHook();
        installEventSourceHook();
        installOpenHook();
        installBannerObserver();
        installHudUpdateHook();
        xcTouchHover.install();
        xcHudDockGuard.install();
        xcInstallBaiShengOuterHook();
        scanBlockBanners();
        skTick();
        xcRecharge.tick();
        xcGaiZhu.tick();
        xcMobile.sync(xcAnyAutomationOn());
    }
    // 多点定时重装
    [50, 150, 400, 800, 1500, 3000, 6000, 10000].forEach(function (t) {
        setTimeout(reinstallAll, t);
    });
    // 持续监测（每 3 秒检查一次，如果被覆盖就重装）
    setInterval(reinstallAll, 3000);

    console.log(TAG, '小抄的拓展 v2.6.6 已启动：xiaochao.org 通信拦截 + 秒杀连点自动购买 + 95折充值 + 盖主速刷（配置 → 游戏辅助，反贼点将支持 不点将/随机/按序，不点将按按序点将排序挑人，新增「等1分钟」烧条；iPad/隔离世界自动注入页面主环境，触屏补发 touch，自动玩法时屏幕常亮；触屏设备上检测不到小抄 HUD 时显示自检卡片；缺 PC 运行时接口时自动补齐并触发小抄重新初始化；捕获小抄初始化错误到自检卡片；自动完成移动版 CtrUtil 的 Wasm 解密器初始化；识别小抄是否被油猴隔离在沙箱并提示使用 iPad 页面版；移动端默认内置小抄，无缓存弹窗下载、下载后提示重进，长按更新按钮开关自动检查更新；95折充值自动填玩家ID并支持打开支付宝；触屏点按可触发悬浮信息；百胜战功打不开时提供备用面板）');
})();
