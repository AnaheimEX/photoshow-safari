# PhotoShow · Safari 移植版

> **个人兴趣项目** · 把 Chrome 扩展 [PhotoShow](https://github.com/Mr-VincentW/PhotoShow)（作者 Mr-VincentWang）移植到 macOS Safari 自用。
> 这**不是**作者官方发布的 Safari 版本，纯粹是个人使用性质，按 MIT 协议开放移植层源码，不提供任何担保。

[PhotoShow](https://github.com/Mr-VincentW/PhotoShow) 是一个浏览器扩展：鼠标悬停在图片缩略图上即可查看高清原图，并通过快捷键复制 / 保存。本仓库把它适配到 Safari Web Extension，**保留上游全部站点适配器与图片处理逻辑**，只重写 Safari 不支持的 API。

- 移植基线：上游 `4.93.2`（SHA-256 见 `safari/port-info.json`，构建脚本会断言版本）
- 当前移植版本：`4.93.2.13`
- 环境：macOS 14+、Safari 26+、完整 Xcode

## 本仓库包含什么

| 内容 | 说明 |
|---|---|
| `safari/prepare.py` | 移植主脚本：从上游包解包、逐项打补丁、同步资源、ASCII 化、生成 Xcode 工程并调校构建设置 |
| `safari/build.command` | 一键构建：生成工程 → Release 双架构（arm64 + x86_64）→ ad hoc 签名 → 产物校验 |
| `safari/Support/` | 移植新增代码：Safari 兼容层、保存页、原生剪贴板处理器与 entitlements |
| `safari/Tests/` | 23 项移植回归测试（JS 兼容层 + Swift 原生剪贴板） |
| `safari/port-info.json` | 上游包校验和、最低 Safari 版本、被移除的不兼容规则清单 |
| `safari/PORT_LOG.md` | 完整移植记录：13 次构建的定位与修复过程 |

**不包含上游安装包及其派生代码**：上游自 2024-07-12 起改为 all rights reserved，因此 `photoshow.zip`、解包目录、生成的 `WebExtension/` 与 Xcode 工程（内含上游资源副本）都不入库，由构建脚本在本地从你自取的上游包生成。

## 构建

```sh
# 1. 自取上游 PhotoShow 4.93.2 的 Chrome 安装包（zip），放到仓库根目录，命名为 photoshow.zip
#    （例如从 Chrome Web Store 安装后，在 chrome://extensions 里「打包扩展」导出；
#     版本必须一致，prepare.py 会断言；可用 port-info.json 中的 SHA-256 校验）
# 2. 一键构建
./safari/build.command
# 产物：safari/dist/PhotoShow Safari.app
```

脚本对上游版本号和每个补丁位置做断言，**升级上游版本前必须先核对补丁锚点，不能跨版本直接套用**。

## 启用

1. 打开 `safari/dist/PhotoShow Safari.app`（建议复制到「应用程序」固定保存）
2. Safari 设置 → 开发者 → 允许未签名扩展（没有「开发者」页时先在「高级」中开启网页开发者功能）
3. Safari 设置 → 扩展，启用 PhotoShow，并允许访问需要预览图片的网站
4. 重新加载网页，把鼠标移到缩略图上

当前为 ad hoc 本机签名，没有开发者证书和公证；Safari 重启后可能需要重新允许未签名扩展。不会自动更新。

## 使用

| 操作 | 快捷键 |
|---|---|
| 悬停查看高清图 | 鼠标悬停（默认启用「无需打开查看器即可操作」） |
| 复制原图 | `C`（悬停时或查看器内） |
| 复制图片地址 | `Alt+C` |
| 复制图片说明 | `Shift+C` |
| 保存图片 | `S` |
| 新标签打开 | `Tab` |
| 关闭查看器 | `Esc` |
| 全局开关 | `Alt+P` |

工具栏弹窗调整当前网站设置，扩展选项页调整全局设置。

## 与上游 Chrome 版的平台差异

Safari 不支持本移植依赖的部分 API，已做对应改写，能力不完全与 Chrome 等效：

- **下载**：Safari 无 Chrome `downloads` API，改为扩展内「保存页」——保存时打开一个页面，点击其中链接由 Safari 原生下载。最终文件名和位置由 Safari 决定，**不支持上游的自动下载子目录**。保存页单文件上限 32 MB，最多 4 个待领取任务，未领取数据 2 分钟后释放。
- **复制**：受 Safari 异步剪贴板与用户手势限制，高清图复制改走应用内原生通道（`nativeMessaging` → `NSPasteboard` 写 PNG），不依赖已失效的网页手势；`C` / `Alt+C` / `Shift+C` 同路径。
- **网络规则**：Safari 不支持 DNR 响应头条件 / 改写，对应静态规则与动态 CORP 改写已移除（清单见 `safari/port-info.json`），少数网站的跨域受限图片能力不等效。
- **后台**：service worker + offscreen document 改为非持久后台页面；后台卸载后其 Blob URL 失效，长时间后操作旧 Blob 图片页需返回原网页重新悬停。
- **同步**：`storage.sync` 仅保存在本机，不跨设备同步。
- **编码**：Safari 以系统旧编码（简体中文环境为 GBK）解码扩展脚本，`prepare.py` 已把所有 JS 非 ASCII 字符转义为 `\uXXXX`（解析后与原文逐字等价）。

## 个人定制项

因为是自用版，在上游基础上做了减法：

- **遥测已关停**：上游向 Google Analytics 回传使用事件的函数整体替换为无操作，个人版不做任何外发统计。
- **摘除 `webRequest` 权限**：重定向跟踪仅为保存预填文件名，本移植版不依赖。
- **语言包精简**：`_locales` 只保留 `en` / `zh_CN` / `zh_TW`，扩展体积 3.9 MB → 3.3 MB。
- 保留不动：全部站点适配器、声明式请求头规则、右键菜单、保存页流程。

## 测试

```sh
cd safari/Tests
node compat.test.cjs   # 23 项移植回归测试
swift run ClipboardNativeCheck.swift  # 原生剪贴板写入校验（独立命名剪贴板，不碰系统剪贴板）
```

覆盖：启动序列、导航事件缺字段、权限探测、剪贴板原生通道、ASCII 化文本保持、语言包裁剪等。测试不调用用户剪贴板、不下载真实图片、不改 Safari 网站权限；真实网页悬停 / 复制 / 下载效果需启用扩展后人工验收。

## 致谢

- 上游项目：[PhotoShow](https://github.com/Mr-VincentW/PhotoShow) by Mr-VincentWang —— 全部站点适配与图片处理能力均来自上游，本仓库只是平台适配层。
- [Apple Safari Web Extension 文档](https://developer.apple.com/documentation/safariservices/safari_web_extensions)

## 许可证

- 本仓库的**移植层代码**（`safari/` 下的脚本、兼容层、原生组件与测试）按 **MIT** 协议开源，见 [LICENSE](./LICENSE)。
- **PhotoShow 上游代码与安装包不包含在本仓库中**：其作者自 2024-07-12 起保留所有权利（all rights reserved）。仓库中 `prepare.py` 的补丁仅为个人合法使用而编写，请自行从官方渠道获取上游扩展。
- 本项目与上游作者无任何隶属关系，不声称取得其商标或再分发授权。
