# 微端安装包工具

给「官方三国杀微端 + 小抄微端插件」用的拓展安装器。用户说明见仓库根目录
[`微端使用说明.md`](../../微端使用说明.md)。

## 目录

| 路径 | 说明 |
|------|------|
| `生成微端安装包.js` | 读取根目录最新的 `小抄的拓展-<版本>.js`，套模板生成安装包目录和 zip |
| `自检.js` | 对补丁脚本做回归验证（注入、幂等、语法、更新器插桩、IPC/preload 模拟） |
| `模板/install.ps1`、`模板/install.bat.head` | 拼成 `install.bat`（批处理头 + 内嵌 PowerShell） |
| `模板/restore.ps1`、`模板/restore.bat.head` | 拼成 `restore.bat` |
| `模板/install.sh`、`模板/restore.sh` | macOS 安装/恢复 |
| `模板/apply-patch.ps1`、`模板/apply-patch.sh` | 真正的补丁逻辑，安装器和微端自动更新器都会调用 |
| `模板/安装说明.txt` | 打进安装包给用户看的说明 |
| `输出/` | 生成产物（已 gitignore） |

## 生成

```bash
node 工具/微端/生成微端安装包.js
```

## 自检

```bash
node 工具/微端/自检.js <解压后的小抄微端 app 目录>
```

`app` 目录从 `https://xiaochao.org/download/weiduan/xiaochao-latest.zip`
的 `app.zip` 解压得到。自检会把 app 复制到临时目录再打补丁，不改动原目录。

## 补丁做了什么

1. 拓展脚本放 `resources/xc-ext/xc-ext.js`（在 app 之外，插件整包更新不会删掉）；
2. `app/main.js` 末尾注册 `xc-ext-source` 同步 IPC；
3. `app/script/electron_renderer.js` 末尾追加代码，在 preload 阶段
   `webFrame.executeJavaScript` 把拓展注入页面主环境；
4. 给 `app/micro-client-updater.js`（Windows）和 `app/main.js`（macOS）的自动更新器
   模板插桩，解压新 app 后先调用 `apply-patch`，保证插件更新后拓展自动保留。

所有补丁都是幂等的（靠 `==XC-EXT-*==` 标记判断），重复运行不会重复注入。
