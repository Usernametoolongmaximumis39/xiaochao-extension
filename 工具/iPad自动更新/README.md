# 小抄 iPad 页面版 · 自动更新镜像

## 为什么需要它

iPad 上的 Safari 油猴（Stay 等）不支持官方小抄头部的 `@sandbox raw`，带 GM 授权
（`@grant GM_xmlhttpRequest` / `@grant unsafeWindow`）的脚本会被放进**沙箱世界**，
读不到游戏的页面变量，HUD 永远出不来。解决办法是把脚本头部改成 `@grant none`，
让它在**页面主环境**运行（见仓库根目录 `iPad使用说明.md`）。

问题是：官方小抄每次更新都会重新带回 GM 授权，手动改一次只能管一个版本。

Stay 的「自动更新」只认脚本头部的 `@updateURL` / `@downloadURL`。所以这里提供一个
**在线镜像**：它每次被请求时读取官方最新版，只把头部改成 `@grant none`，并把
`@updateURL` / `@downloadURL` 指回镜像自己。Stay 打开「自动更新」后，官方更新
→ 镜像返回最新补丁版 → Stay 自动同步，不需要再手动移植。

镜像不存储、不执行官方代码，只做字符串头部替换；返回前用 SHA-256 校验正文与官方一致。

## 部署（Cloudflare Workers，免费，约 3 分钟）

1. 打开 <https://dash.cloudflare.com>，注册/登录（免费计划即可）；
2. 左侧 **Workers & Pages** → **Create application** → **Create Worker**；
3. 名字随意，例如 `xiaochao-ipad` → **Deploy**；
4. 点 **Edit code**，把编辑器里的模板全部删掉，粘贴本目录 [`worker.js`](worker.js) 的全部内容；
5. **Save and deploy**；
6. 记下地址，脚本 URL 形如：

   ```
   https://xiaochao-ipad.<你的子域>.workers.dev/xiaochao-ipad.user.js
   ```

7. 自检：
   - 浏览器打开脚本 URL：头部应为 `@name 小抄（iPad 页面版）`、`@grant none`、
     `@updateURL`/`@downloadURL` 指向这个 URL、`@version` 为官方最新版；
   - 打开 `脚本URL?meta=1`：返回 `{version, fromCache, bytes, selfUrl}`。

> ⚠ 请自己部署。不要使用别人提供的公共镜像——镜像可以篡改脚本内容，等于把游戏账号交给对方。

## 在 Stay 里安装与自动更新

1. 先停用/删除旧的「小抄」和旧的「小抄（iPad 页面版）」，避免同时运行；
2. Stay → 添加脚本 → **脚本地址链接**，填上面的脚本 URL（也可以在 Safari 打开该 URL，
   按 Stay 的安装提示操作）；
3. 在 Stay 的脚本列表里，对「小抄（iPad 页面版）」打开 **自动更新**；
4. 之后官方小抄更新时，Stay 会在下次检查更新时自动拉取镜像的最新版本；
   想立刻验证可以手动点一次「检查更新」。

## 排查

- 打开脚本 URL 看到 `// xiaochao-ipad 镜像错误：...`：说明访问官方接口或下载失败，
  返回 502；Stay 会保留旧版本，稍后重试即可。
- 镜像返回的版本没变：先看 `?meta=1` 的 `version`；官方配置接口本身有缓存，可能滞后几分钟。
- Stay 没有自动更新：确认该脚本的「自动更新」开关已打开；部分版本只在 App 启动/后台检查。

## 不部署镜像时的备选

仓库根目录的 `工具/生成iPad页面版小抄.js` 可以在本地离线生成页面版：

```bash
node 工具/生成iPad页面版小抄.js
```

它只改头部、正文与原版逐字节一致，但生成的脚本没有可用的 `@updateURL`，
**每次官方更新后需要手动重新导入**。镜像方案才能做到自动同步。
