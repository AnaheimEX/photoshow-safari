# PhotoShow · Safari 本机适配版

以目录内的 `photoshow.zip`（PhotoShow 4.93.2）为源，保留作者原有站点适配和图片处理代码，针对 Safari WebKit 改写并用 Xcode `safari-web-extension-converter` 打包。原始 Chrome 包、解压目录和分析文件未修改。这不是作者官方发布的 Safari 版本。

## 使用

1. 打开 `dist/PhotoShow Safari.app`；建议先复制到「应用程序」固定保存。
2. Safari 设置 → 开发者 → 允许未签名的扩展。没有开发者页时，先在高级设置中开启网页开发者功能。
3. Safari 设置 → 扩展，启用 PhotoShow，允许访问需要预览图片的网站。
4. 重新加载网页，将鼠标移到缩略图上。工具栏弹窗调整当前网站设置，扩展选项调整全局设置。
5. 保存图片时会打开扩展的保存页，点击其中链接由 Safari 下载。最终文件名和位置由 Safari 决定，不支持原版自动下载子目录功能。保存页单文件上限 32 MB，最多 4 个待领取任务；未领取数据 2 分钟后释放，超限会明确提示。

要求 macOS 14+、Safari 26+，Apple Silicon／Intel 通用构建。当前为 ad hoc 本机签名，没有开发者证书和公证，Safari 重启后可能需要重新允许未签名扩展。本机版本不会通过 Chrome 商店或 App Store 自动更新。

## 适配内容

- Chrome service worker + offscreen document 改为 Safari 非持久后台页面，直接调用原来的图片任务表，保留 Canvas 格式转换、旋转、翻转、任务取消和 Blob URL 释放。
- Safari 不提供 Chrome downloads API。移除该 API 的启动监听和调用，改为独立保存页，在真实用户点击后使用浏览器原生保存。
- 移除不支持的 `offscreen`、`downloads`、`favicon`、`publicSuffix` 权限；原 publicSuffix 调用已有保护，缺失时仍按精确网站申请权限。
- 对缺少的工具栏文字颜色、固定状态查询采用能力检测；使用打包图标替代 Chrome 内部 favicon 地址。
- WebKit 公开 Shadow DOM 回退修正；不声称能读取关闭的 Shadow DOM。
- 不恢复已经失效的后台 Blob URL 缓存，避免 Safari 后台重启后信任旧 URL。
- Release 双架构、沙箱、Hardened Runtime，无调试权限注入。

## 平台差异

Safari 不支持本包依赖的 DNR 响应头条件/改写，已移除对应静态规则和动态 CORP 改写，并保留受支持的请求头规则。部分网站的跨域受限图片、强制将二进制文件当图片打开等能力因此不与 Chrome 等效。具体移除项见 `port-info.json`。

复制图片仍受 Safari 的剪贴板权限及临时用户激活限制；慢速图片处理或无用户手势调用可能失败。网页快捷键复制比后台菜单操作更容易满足用户操作要求，失败时保留原错误提示。

Safari 的 `storage.sync` 保存于本机，不进行跨设备同步。原版界面使用的通用“同步”术语不代表 Safari 具备该能力。

非持久后台卸载后，其 Blob URL 会失效。新的图片任务会重新生成数据；长时间后继续操作旧 Blob 图片页可能需要返回原网页重新悬停。

## 重建

安装完整 Xcode 后，在项目根目录运行：

```sh
./safari/build.command
```

脚本对版本和每个源代码补丁位置做断言，同步资源并生成 `safari/dist/PhotoShow Safari.app`。更换原始 ZIP 或升级 PhotoShow 后，应先核对源码补丁，不能直接跨版本套用。

维护源：`prepare.py`、`build.command`、`Support/`。`WebExtension/`、Xcode 工程里的扩展资源和引导页为生成副本。`port-info.json` 记录原始 ZIP 校验和、最低 Safari 版本及删去的不兼容规则。

## 已执行检查与验证边界

8 项适配测试通过，JavaScript 语法检查通过；Release 双架构构建、深层严格签名和应用内资源逐文件一致性检查通过。中文引导页已实际打开，原始 Chrome 解压目录与 ZIP 内容保持一致。

协议适配测试不调用用户剪贴板，不下载真实图片，不改变 Safari 网站权限。编译、签名、资源校验和引导页启动可单独验证；真实网页悬停、复制和下载效果需启用扩展后验证，不能用构建成功替代。

原作者信息与原包内容保留。此目录仅为用户本机适配，不声明取得作者商标或再分发授权。

参考：[PhotoShow 项目](https://github.com/Mr-VincentW/PhotoShow)、[Apple Safari 兼容性说明](https://developer.apple.com/documentation/safariservices/assessing-your-safari-web-extension-s-browser-compatibility)。

## Build 2：后台启动异常修复

修复 `browser_specific_settings?.gecko.data_collection_permissions` 在 Safari 清单下抛出 TypeError 的问题。Safari 清单存在 `browser_specific_settings`，但没有 Firefox 的 `gecko` 字段；原来的局部可选链无法保护后续读取，导致后台在注册消息处理器前中断，权限状态和图片功能因此无法正常工作。现在逐层检查可选字段。

使用实际后台表达式复现了异常，修复后该回归测试及原有适配测试共 9 项通过。应用与扩展构建号均为 2；已重新构建并校验签名。测试不代表 Safari 实际网页图片预览已验收。

更新后打开本目录的应用，在 Safari 扩展设置中关闭再启用 PhotoShow，然后刷新目标网页，让 Safari 重新加载后台代码；不需要撤销已有的网站授权。

## Build 3：区分网页权限与后台连接失败

扩展运行时版本为 `4.93.2.3`，原生构建号为 `3`。

- 当前网页访问判定改为调用 Safari 的 `scripting.executeScript` 做实际文档探测，不再用 `permissions.contains()` 返回值阻止探测。Safari 自身仍执行权限检查，没有扩大清单权限。
- 不缓存网页的访问判定，避免授权变更后沿用旧状态。
- 明确的权限拒绝返回“需要授权”；关闭的标签、不可用的文档、探测异常等返回“不可用”。
- 弹窗拿不到后台回复时显示“后台未响应”，不再错误归入“需要授权”。

13 项模拟/回归测试通过，包括权限查询为否但实际探测成功、授权撤销、非权限故障，以及弹窗没有后台回复的场景。用户选择稍后自行验证；本轮没有完成 Safari 实际网页验收，不能据此确认当前机器具体触发的是哪一条路径。

加载新版本：关闭再启用 PhotoShow，并刷新目标网页。若仍显示“后台未响应”，该提示表示消息链路异常，应提供当前后台控制台的新报错，继续定位；无需反复更改所有网站访问权限。

## Build 4：Safari 高清图复制

运行时版本 `4.93.2.4`，原生构建号 `4`。

`C` 不再走 Chrome 的临时 `clipboardWrite` 申请/撤销流程。原版异步高清图获取和 PNG 转换保持不变，生成的 PNG 经扩展后台发送给同一应用内的 Safari 原生扩展处理器，由 macOS `NSPasteboard` 写入。这样不依赖异步下载完成后已经失效的网页用户手势。`Alt+C` 图片地址和 `Shift+C` 图片说明也使用同一路径。

只添加应用内的 `nativeMessaging` 能力，不安装额外守护进程或 Chrome Native Messaging host，不读取已有剪贴板。原生处理器只接受复制文本或有效 PNG；PNG 上限 32 MiB、1 亿像素，文本上限 1 MiB。图片仍按原版使用自然尺寸转为 PNG，不以缩略图代替，不额外缩小。只有原生写入确认成功后才显示成功。

验证：16 项 JavaScript 测试通过；原生处理器在独立命名剪贴板上完成 PNG 写入，读回字节与输入完全一致；无效数据不改变剪贴板；文本写入通过。测试没有读取或覆盖用户当前系统剪贴板。Release 构建及签名校验通过。Safari 实际悬停后按 `C`、再粘贴到目标应用的完整操作仍由用户验收。

更新后关闭再启用 PhotoShow 并刷新网页，再悬停图片按 `C`。需要时打开 `dist/PhotoShow Safari.app` 让系统发现更新。

依据：[WebKit 异步剪贴板与用户手势要求](https://webkit.org/blog/10855/async-clipboard-api/)、[Apple Safari 原生消息接口](https://developer.apple.com/documentation/safariservices/messaging-between-the-app-and-javascript-in-a-safari-web-extension)。

## Build 5：修复导航事件导致再次失效

运行时版本 `4.93.2.5`，原生构建号 `5`。

按用户提供的 `background/background.js:22:7052` 定位到 `webNavigation.onCommitted` 回调：Safari 缺少 `transitionQualifiers` 时，原代码直接调用 `.includes()` 抛错；同一回调还要求 `documentLifecycle === "active"`，缺少此字段会直接跳过内容脚本注入。

缺少的跳转修饰列表现在按空数组处理；缺少生命周期按普通已提交文档处理。明确标为 prerender 等非活动文档仍排除。保留 Build 4 的原生高清图复制功能。

已用实际生成的导航回调复现原报错，修复后验证新网页注入及明确非活动文档排除；共 18 项测试通过，构建与签名校验通过。修正版部署至 `Safari-extensions/PhotoShow Safari.app`。Safari 实际网页导航和悬停仍待重新加载扩展后验收。

## Build 6：启动链加固与构建清理

运行时版本 `4.93.2.6`，原生构建号 `6`。

针对“后台仍有报错”做了一次完整审议：把最终生成的后台、弹窗、选项、保存页与内容脚本放入按 Apple／MDN 兼容性数据裁剪 API 表面的模拟 Safari 环境，逐项执行启动、导航、标签激活与弹窗流程。完整 API 表面下未复现启动崩溃；但审议发现后台启动注册序列中仍有两处与 Build 2、Build 5 同型的单点故障，现已一并消除：

- `Ci.init()`（webRequest 重定向跟踪，仅用于预填保存文件名）无保护地位于启动注册序列中段，其内部读取 `chrome.webRequest.onHeadersReceived`；该命名空间一旦不可用，抛错会中断其后的全部注册（包括快捷键命令监听）。现以 try/catch 包裹，跟踪器失败不再影响后台启动。
- `chrome.windows.onFocusChanged` 注册与 `executeForAllActiveTabs` 中的 `chrome.windows.getAll()` 同样无保护，现改为可选链加空结果回退，缺失时降级为“无窗口”而非同步抛错。

构建清理：`prepare.py` 改为先清空再解压 `WebExtension/`，同步到 Xcode 工程时一并清理已被删除的负载文件，避免上游删除的资源永久残留在应用内。保存页达到待领取上限被拒绝时，只释放兼容层真正创建的 Blob URL，不再回收仅前缀相同的后台 URL。

新增 2 项回归测试，共 20 项通过；模拟环境在分别缺失 webRequest、windows、contextMenus 及其组合的变体下均无启动异常。本轮未能取得 Safari 控制台中的具体报错文本；重新编译后请在 Safari 中关闭再启用 PhotoShow 并刷新网页验证。若仍有报错，提供后台控制台的新报错原文（形如 `background/background.js:行:列`）即可按 Build 5 的方式继续定位。另注意：macOS 27 存在“允许未签名扩展后扩展不出现或状态异常”的已知系统问题，处理方式是重建应用并重新启用，与本次代码修改无关。

## Build 7：正则诊断版（临时）

运行时版本 `4.93.2.7`，原生构建号 `7`。

Build 6 启用后，Safari 设置的扩展出错列表出现 `SyntaxError: Invalid regular expression: range out of order in character class (background/background.js:1)`，但不提供是哪一条正则。本轮先取构建产物中的 `background/background.js` 与审议副本逐字节核对一致，再以 JavaScriptCore（经 Bun）实测：整文件解析、后台三段脚本（safari-compat.js、offscreen.js、background.js）同上下文启动、onInstalled/onStartup、弹窗/选项/保存页/内容脚本完整流程全部通过；扩展内全部静态正则、sites 适配器正则，以及 8 条运行时拼装正则（代入真实常量）逐条编译均合法——在本机无法复现该报错，怀疑与本机真实存储数据或特定页面数据触发的路径有关，无法静态定位。

故本版为诊断版：`safari-compat.js` 末尾给 `RegExp` 构造加了一层透明包装，被引擎拒绝的动态正则在抛错前先把原文打进后台控制台，格式为 `[PhotoShow regex diagnostic] invalid pattern: "..." flags: "..."`；合法构造、匹配与 `RegExp.$1` 等行为不变（已验证）。重编启用后正常使用，报错一旦复现，控制台即会给出坏正则原文；拿到原文后出 Build 8 在源头修复，并移除本诊断层。

新增 1 项回归测试（坏正则被记录且仍抛错、合法正则与 `$1` 不受影响），共 21 项通过；JSC 下三段后台脚本同上下文启动无异常。注意：Safari 设置里已有的出错记录不会自动消失，以后台控制台的诊断日志为准。

## Build 8：诊断信息写进报错本身

运行时版本 `4.93.2.8`，原生构建号 `8`。

Build 7 的诊断日志只落在后台控制台，而实际查看的是 Safari 设置页的出错列表——两者不在一处。本版把诊断改为双通道：被拒绝的动态正则除继续打印控制台日志外，抛出的 SyntaxError 消息末尾直接附上原文（`[PhotoShow diagnostic] pattern="..." flags="..."`），于是设置页的出错列表会出现一条自带 pattern 的新记录，一眼可辨。合法构造行为不变。

同时修正 Build 7 升版时漏改的显示名：`prepare.py` 中写死的 `version_name` 此前仍为 `4.93.2 Safari 6`（版本号本身无误），本版起为 `4.93.2 Safari 8`，设置页标题不再误导。

测试仍为 21 项（原诊断测试扩展为同时断言错误消息携带 pattern）。若本版启用后出错列表出现带 pattern 的新记录，即可据此出正式修复版并移除诊断层；若出现的仍是不带 pattern 的旧式消息，则证明该错误不经后台页面的 RegExp 构造抛出，改从脚本注入／其他上下文方向定位。

## Build 9：启动阶段标记（临时）

运行时版本 `4.93.2.9`，原生构建号 `9`。

新证据推翻了此前的定性：2026-11-03 后台页面检查器中实时复现同一条裸 SyntaxError，展开堆栈只有「匿名函数」一帧，且 `globalThis.photoShow`、`globalThis.tools` 均为 undefined——脚本死在初始求值期内、未走到约九成处的全局赋值。同日探针（`~/Downloads/photoshow-parse-probe.jxa`）以系统 JavaScriptCore 逐个 eval 三处副本：build 产物与 dist 的 background.js 均只报沙箱缺失的 `URLSearchParams`、compat 完整执行——所有副本解析无误。故该错误不是文件里的字面量正则，而是 Safari 真实后台环境中初始求值期的运行时失败，本地引擎复现不了。

本版为定位版：`prepare.py` 在 background.js 初始求值的十个里程碑处注入阶段标记（`corejs`、`utils`、`store`、`helpers`、`configs`、`menus`、`download`、`webrequest`、`sites`、`pre-tools`；位于声明链内部的锚点以逗号表达式承载标记）；`safari-compat.js` 在后台脚本运行前抢先登记错误陷阱，把最后到达的阶段与错误位置（行列）记入 `globalThis.__psError`。重编启用后打开后台检查器，读 `__psStage` 与 `__psError` 即可圈定致命段：报告的阶段是最后跑完的一段，错误就在其后一段内；`colno` 即 background.js 第 1 行内的字符偏移，可直接对应源码位置。Build 8 的 RegExp 包装诊断保留。

新增 2 项回归测试（阶段标记按序注入、错误陷阱记录阶段与列号），共 23 项通过；JSC（Bun）下三段后台脚本同上下文启动及 updateTabState/checkSite/弹窗问答冒烟无异常。验收读数回报后据此出正式修复版，并移除两层临时诊断（正则包装与阶段标记）。

## Build 10：正则字面量逐条隔离（临时）

运行时版本 `4.93.2.10`，原生构建号 `10`。

Build 9 验收读数（2026-11-03 13:12）：`__psStage` 停在 `compat-loaded`，即 background.js 的第一个阶段标记都未执行；`__psError` 记录 filename 为 background.js、lineno 1、**colno 0**——这是整文件解析失败的特征，而非运行时抛错。结合副本探针（所有副本在系统 JavaScriptCore 下解析通过；JXA 的 eval 为惰性解析，未逐条验证函数体内的字面量），定性为：Safari 的解析器在整文件编译时拒绝 87 条正则字面量中的某一条，该条多半只存在于函数体内，故惰性解析的主机（JXA）与逐条构造验证（Bun/Node）都放行，唯独 Safari 的急切解析撞上。

本版把 87 条字面量逐条拆成独立后台脚本 `safari/probe/p000.js`–`p086.js`（内容只有该条字面量本身，严格模式），按原文件顺序排在 offscreen.js 与 background.js 之间加载。哪一条被 Safari 拒绝，控制台报错的文件名就是哪一个 pNNN；对照 `prepare.py` 中 `REGEX_PROBE_LITERALS` 列表的第 NNN 条即得原文，随后在源头改写该字面量出正式修复版。阶段标记与错误陷阱保留（若 87 条全部放行而 background.js 仍死于 compat-loaded，则排除字面量、转入调用链二分）。

新增 1 项回归测试（探针脚本数量/顺序/可解析性），共 24 项通过；探针文件内容与字面量清单逐字节核对一致。

## Build 11：正式修复——脚本纯 ASCII 化

运行时版本 `4.93.2.11`，原生构建号 `11`。

Build 10 验收（2026-11-03 13:17）：报错落在 `safari/probe/p028.js`——第 28 条字面量 `/\s*[(（]\s*[)）]\s*/g`（Fn 的空括号剥离），错误为「Unterminated regular expression literal」，且控制台里的字面量呈 GBK 乱码。根因就此坐实：**Safari 以系统旧编码（简体中文环境为 GBK）而非 UTF-8 解码扩展脚本**。多字节字符被误读时，其尾字节会吞掉正则字面量里的结构字符（`\`、`]`）：本地 GBK 模拟解码复现——`（` 的 UTF-8 尾字节与随后的 `]` 配成一个汉字、字符类永不闭合；全文件尺度上被吞的类边界使后续字符类范围倒置，即最初的「range out of order in character class」。用户此前贴回的源码乱码（`缂哄皯鏉冮檺` 等）同样是 Safari 检查器里的 GBK 解码结果，与本地模拟逐字吻合。Chrome 按 UTF-8 解码，故上游包无此问题。

修复：`prepare.py` 在全部补丁之后、同步进工程之前，把 WebExtension 内每个 `.js` 的非 ASCII 字符逐一转义为 `\uXXXX`，产物纯 ASCII（并断言校验）；解析后的字符串与正则与原文逐字等价（已验证中文权限正则、全角括号剥离等行为不变）。431 个 JS 文件全部 ASCII 化；21 项测试通过（4 项临时诊断测试随诊断层移除，新增 ASCII 与文本保持测试），Bun(JSC) 三段后台冒烟无异常。

临时诊断全部移除：RegExp 包装（Build 7/8）、阶段标记与错误陷阱（Build 9）、探针脚本（Build 10）。验收：重编后 Cmd+Q 重开 Safari，弹窗应不再报「后台未响应」，打开图片页验证浮图秀正常注入。

## Build 12：精简与强化（正式修复后调优）

运行时版本 `4.93.2.12`，原生构建号 `12`。Build 11 已由用户验收可正常使用；本轮按用户实际需求（悬停看高清图、快捷键复制高清图）做减法与加固：

- **关停遥测外发**：上游统计发送函数 `So` 向 Google Analytics（Measurement Protocol，硬编码密钥）回传使用事件，发送前还做 IP/地理位置查询；个人自用版毫无必要。`prepare.py` 将其函数体整体替换为无操作（唯一调用方为即发即弃），替换前断言锚点含 GA 域名。使用数据同意开关原本默认关闭，本版起代码层面彻底无外发。
- **摘除 webRequest 权限**：重定向跟踪（Ci）只为保存文件预填文件名，本移植版的保存流程并不依赖它；权限摘除后其初始化由 Build 6 的 try/catch 兜底降级，后台不再为每个请求挂监听。
- **语言包精简**：`_locales` 只保留 en、zh_CN、zh_TW（原 19 个），扩展体积 3.9 MB → 3.3 MB。
- 保留不动：422 个站点适配器（高清图提取的核心）、声明式规则（Instagram UA）、右键菜单、保存页流程。

与用户流程相关的既有能力（审议确认，非本版新增）：悬停图片按 **C** 直接复制原图（无需打开查看器，`imageActionShortcutsWithoutViewer` 默认开）；查看器内 C 复制、Alt+C 复制地址、Shift+C 复制标题、S 保存、Tab 新标签打开、Esc 关闭；复制走原生通道写 PNG。

新增 2 项回归测试，共 23 项通过；Bun(JSC) 三段后台冒烟无异常，全部 JS 仍纯 ASCII。
