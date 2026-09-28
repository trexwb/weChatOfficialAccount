# AGENTS.md - 公众号HTML插入助手 开发规范

> 所有 AI Agent 在本项目中开发时必须遵循本文件规范。

---

## 项目概述

**公众号HTML插入助手** 是一款纯前端 Chrome 浏览器扩展（Manifest V3），在微信公众号文章编辑页注入悬浮按钮，提供自定义 HTML 的编辑、模板、净化与插入能力。

**技术栈**：原生 JavaScript（IIFE + 'use strict'）+ CSS + CodeMirror 5（本地化依赖）。**无构建链**：无 package.json、无打包器、无 npm 脚本，改动后直接「重新加载扩展」生效。

**核心原则**：稳定 → 简洁 → 本地化（零远程依赖）

**当前版本**：`v1.0.0`

---

## 版本管理规范

> ⚠️ **用户硬性约束（最高优先级，覆盖下方默认规则）**
> - **禁止任何 agent 执行 Git 提交类操作（`git add` / `git commit` / `git push` / `git tag` 等）**：所有改动留在工作树，由用户本人决定是否提交。
> - 新功能（MINOR）与重大变更（MAJOR）**由用户决定**，AI 不得擅自提升（如私自从 v1.0.0 升到 v1.1.0 属违规，除非用户明确要求）。
> - AI 只允许在**最后一位（PATCH）自增**：`v1.0.0` → `v1.0.1` → `v1.0.2` …

### 版本号格式

语义化版本号（Semantic Versioning）：`vMAJOR.MINOR.PATCH`

| 修改类型 | 版本号变化 | 示例 |
|----------|-----------|------|
| Bug 修复、样式调整、小改进 | PATCH +1 | `v1.0.0` → `v1.0.1` |
| 新增功能、功能增强 | MINOR +1, PATCH 归零（需用户决定） | `v1.0.2` → `v1.1.0` |
| 重大变更、架构重构 | MAJOR +1（需用户决定） | `v1.9.0` → `v2.0.0` |
| 纯文档修改（README/报告/本文件） | 不升版本号 | — |

### 版本号存储位置（真源）

**唯一真源**：`manifest.json` 的 `version` 字段。

**同步派生（随改动一起更新，不得遗漏）**：
- `README.md` → 版本历史表新增一行
- `升级路线图.html` → 如有路线图进度变化，同步状态
- 大版本/功能升级时，生成/更新 `升级报告-vX.Y.Z.html`

### 更新流程

每次代码修改完成后，Agent 必须：

1. 确定版本号增量类型（新功能/大变更先询问用户，仅 PATCH 可自增）
2. 更新 `manifest.json` 的 `version`
3. 在 `README.md` 版本历史表新增对应行
4. 修改文件前先备份：`cp <file> <file>.bak-<旧版本>`（如 `content.js.bak-1.0.0`）
5. 语法校验：`node --check content.js`、`node --check background.js`、`node --check options.js`，`node -e "require('./manifest.json')"`
6. 更新本文件「更新日志」章节（记录变更内容与版本号）

---

## 开发规范

### 1. 架构分层

```
manifest.json           # MV3 清单：内容脚本加载序 / 权限 / 后台 / 设置页
├── content.js          # 页面注入层：悬浮按钮、编辑弹窗、CodeMirror、插入/净化/模板/同步
├── background.js       # MV3 Service Worker：右键菜单（chrome.contextMenus）
├── options.html/js     # 设置页：模板管理（重命名/删除/导入/导出）、净化默认值
├── styles.css          # 全部样式（含 CodeMirror 主题化、深色模式）
└── lib/codemirror/     # CodeMirror 5 本地依赖（唯一第三方依赖，禁止外链）
```

- ✅ 页面注入逻辑全部在 `content.js`（IIFE 包裹，顶部平台判定，非目标页直接 `return`）
- ✅ 后台逻辑（右键菜单）在 `background.js`，只做消息转发，不含业务逻辑
- ✅ 设置页只读写 `chrome.storage.local`，与 content script 共享模板/设置数据
- ✅ 样式集中在 `styles.css`，不使用内联 `<style>`；主题色使用 CSS 变量（`--green` 等设计令牌）

### 2. 代码风格

- ✅ 缩进 2 空格，不使用 tab
- ✅ 变量/函数命名语义化，禁止 `a`、`b`、`temp` 等无意义命名
- ✅ 常量使用全大写下划线：`EDITOR_SELECTORS`、`STORAGE_KEY`、`VOID_TAGS`
- ✅ 函数必须有注释说明职责；事件监听器命名 `handle*` / `on*`，工具函数 `format*` / `minify*` / `parse*` / `sanitize*`
- ✅ 不使用 `var`（`const` / `let`）；不使用 `console.log` 留调试残留
- ✅ 修改代码前先读现状：所有改动基于当前文件内容，不得凭记忆覆盖

### 3. 平台扩展规范（PLATFORMS 注册表）

- ✅ 平台配置集中在 `content.js` 顶部 `PLATFORMS` 数组：`hostMatch` + `isEditPage` + `selectors`
- ✅ 新增平台（如秀米/135 编辑器）必须同时满足：
  1. `manifest.json` 的 `content_scripts.matches` 增加站点 + `all_frames: true`（这些平台的编辑器在 iframe 内）
  2. 在 `PLATFORMS` 注册表登记**实机验证过**的选择器
  3. 未实机验证的选择器**禁止启用**（占位即误导）
- ✅ 公众号编辑器选择器必须保留三级回退；公众号改版导致失效时，优先更新 `PLATFORMS[wechat].selectors`，不得移除回退链
- ✅ **读写只针对「内部内容」**：编辑器正文一律只读写 `.rich_media_content` 内 `div.ProseMirror[contenteditable]` 的**内部内容**。读取走 `readEditorContent(editor)`，写入范围走 `buildInsertRange(editor, mode)` + `isInnerRange(range, editor)` 守卫，待插入内容先进 `stripContainerWrappers(html)` 网关
- ✅ 容器元素（`.rich_media_content`、`div.ProseMirror`、`.mock-iframe-*`）**不得被替换 / 删除 / 重建 / 包裹，也不得写入正文**：读取结果不得携带容器标签，插入内容不得含容器标签（否则形成嵌套顶坏结构）

### 4. 存储规范

| 数据 | 存储位置 | 说明 |
|------|---------|------|
| 编辑草稿 | 页面 `localStorage`（key: `wx-ext-state-v1`） | 仅编辑页需要，随页面隔离 |
| 模板库 | `chrome.storage.local` → `templates` | 需与设置页共享，跨页面 |
| 设置（净化默认值） | `chrome.storage.local` → `sanitizeDefault` | 需与设置页共享 |
| 敏感数据 | ❌ 禁止存储 | 本项目无敏感数据场景 |

- ✅ 模板/设置读写使用 `remoteStore.get()/set()`（Promise 封装 chrome.storage），禁止在 content script 里直接同步读 chrome.storage
- ✅ 草稿用 `store`（同步 localStorage），保持弹窗打开/恢复的低延迟

### 5. 依赖规范

- ✅ **禁止 CDN / 远程字体 / 外部 API**：MV3 默认 CSP 不允许 content script 执行远程代码，所有依赖必须本地化
- ✅ CodeMirror 5 是唯一第三方依赖，位于 `lib/codemirror/`；**manifest.json 中 JS 加载顺序不可随意调整**：
  核心 → 模式（xml/javascript/css/htmlmixed）→ dialog → searchcursor/search/match-highlighter → matchbrackets → content.js
- ✅ 升级 CodeMirror 前必须逐文件验证大小与导出（`node -e` 检查），并回归「弹窗可打开、高亮正常、查找可用」
- ✅ 引入新库优先选 UMD 单文件形态；ESM/AMD 拆分库（如 js-beautify 的 CDN 版）在无构建链下不可用，优先自实现

### 6. 安全规范

- ✅ 插入公众号的内容默认经过净化（`sanitizeForWeChat`）：移除 script/iframe/object/embed/事件属性，检查未闭合标签
- ✅ 预览区 `innerHTML` 只渲染用户自己编辑的内容（插件定位决定的合理范围）；模板插入前同样走净化开关
- ✅ 禁止 `eval()`、`new Function()`、`document.write()` 等危险 API
- ✅ 不使用 `alert()`/`confirm()` 做交互反馈（用 `.wx-ext-toast`），模板命名可用 `window.prompt`（内容脚本环境限制下的例外）
- ✅ 调试日志完成后必须移除

### 7. UI/UX 规范

- ✅ 颜色/间距使用 CSS 变量与统一设计令牌（绿色主色 `#07c160` 系列）
- ✅ 深色模式：`@media (prefers-color-scheme: dark)` 覆盖，新增 UI 必须同步补深色样式
- ✅ 减弱动态效果：`@media (prefers-reduced-motion: reduce)` 兜底，关闭动画的同时确保逻辑不受动画事件影响（`close()` 必须有 `setTimeout` 兜底）
- ✅ 所有交互按钮必须有 hover/active 反馈；弹窗类交互必须有 Esc 关闭、遮罩点击关闭
- ✅ 新增按钮/控件必须给唯一 `id` 并用 id 绑定事件，**禁止用类名 `querySelector` 绑定唯一控件**（本项目曾因类名歧义导致按钮失效，见历史修复记录）

---

## 文件组织

```
WeChatOfficialAccount/
├── manifest.json            # MV3 清单（版本真源）
├── content.js               # 页面注入核心逻辑（最大文件，按注释分区）
├── background.js            # Service Worker：右键菜单
├── options.html             # 设置页
├── options.js               # 设置页逻辑（模板管理/净化默认值）
├── styles.css               # 全部样式
├── lib/codemirror/          # CodeMirror 5 本地依赖（11 个文件，勿乱序）
├── AGENTS.md                # 本文件（Agent 开发规范）
└── README.md                # 使用说明（含版本历史）
```

### 新增功能流程

1. 读 `README.md` 与 `升级路线图.html` 确认规划方向
2. 判断归属：页面注入 → `content.js`；后台/全局 → `background.js`；设置 → `options.html/js`；样式 → `styles.css`
3. 改动前备份相关文件（`*.bak-<旧版本>`）
4. 实现 + `node --check` 语法校验
5. 按版本规范升版（MINOR 先询问用户）
6. 更新 `README.md` 版本历史 + 本文件更新日志；有路线图关联时同步 `升级路线图.html`

---

## Git 提交规范

> ⚠️ 用户硬性约束：**禁止任何 agent 执行 Git 提交类操作**（add/commit/push/tag 等），
> 改动只保留在工作树，是否提交由用户本人决定。

（以下格式仅供用户本人提交时参考）

```
<type>(<scope>): <subject>
```
- `feat` 新功能 / `fix` Bug 修复 / `refactor` 重构 / `style` 样式 / `docs` 文档 / `chore` 工具

---

## 测试检查清单

### 冒烟测试（每次改代码后，命令行）

- [ ] `node --check content.js` / `background.js` / `options.js` 通过
- [ ] `node -e "require('./manifest.json')"` 解析通过
- [ ] 纯函数（formatHtml/minifyHtml/parseDelimited/sanitizeForWeChat/stripContainerWrappers/isInnerRange）用 node 内联脚本跑一轮边界用例（含引号 CSV、pre 保留、未闭合标签、容器标签剥离与近似类名恒等、越界选区判定）

### 浏览器手动验证（公众号编辑页）

- [ ] 悬浮按钮出现，编辑器就绪后提示变为「插入 HTML」
- [ ] 弹窗打开：CodeMirror 高亮/行号/括号匹配正常，Tab 缩进、Cmd/Ctrl+F 查找可用
- [ ] **空内容可编辑**（v1.0.4）：无草稿/无模板/未点「读取」时，点击编辑区任意位置都能获得光标并正常输入；输入后再清空仍可继续输入
- [ ] 模板：保存/插入/删除；设置页增删后弹窗菜单同步
- [ ] 草稿：输入后关闭重开可恢复；插入成功后清除
- [ ] 格式化/压缩/表格生成/净化提示可用
- [ ] 主弹窗「取消」关闭弹窗；表格生成子窗口「取消」/Esc/遮罩只关子窗口
- [ ] 右键菜单：页面选中文字 → 右键 →「插入选中内容到公众号编辑器」→ 弹窗打开且内容已载入
- [ ] 双向同步：弹窗开着时在公众号编辑器里改动 → 弹窗内容自动刷新
- [ ] 深色模式 / 减弱动态效果下功能正常
- [ ] 弹窗拖动、右下角缩放正常

### 回滚

- 出问题用对应 `*.bak-<版本>` 还原，如 `cp content.js.bak-1.0.0 content.js`

---

## 常见问题

### Q: 如何调试？
1. `chrome://extensions/` → 找到本扩展 → 点「重新加载」（改代码后必须重新加载，页面刷新只是次要动作）
2. 公众号编辑页 F12 → Console 查看报错；`chrome://extensions` 的 service worker 页可看 background.js 日志
3. 检查 manifest 加载序错误：Console 报 `CodeMirror is not defined` 多为 `lib/codemirror/` 未按序加载

### Q: 如何新增一个平台（如秀米）？
1. `manifest.json`：`content_scripts.matches` 增加站点，`"all_frames": true`
2. 实机打开该平台编辑页，用 F12 确认编辑器真实 DOM 结构
3. 在 `content.js` 的 `PLATFORMS` 注册表登记 `hostMatch` / `isEditPage` / 验证过的 `selectors`
4. 回归测试，更新 README 支持范围

### Q: 如何新增一个模板分类/批量操作？
模板存储在 `chrome.storage.local.templates`（`[{name, html}]`），content script 的模板菜单与 options.js 双向读写；新增字段时注意兼容旧数据（读时做默认值兜底）。

### Q: 为什么不能用 js-beautify 这类库？
其 CDN 分发版是 AMD/CommonJS 拆分结构，content script 无模块加载器且 MV3 CSP 禁止远程代码；无构建链项目里自实现（本项目 `formatHtml`/`minifyHtml` 共约 80 行）比引入构建更合理。

---

## 禁止事项

- ❌ 禁止执行任何 Git 提交类操作（add/commit/push/tag）
- ❌ 禁止擅自提升 MINOR / MAJOR 版本号（需用户决定）
- ❌ 禁止用类名 `querySelector` 绑定唯一控件（必须用 id）
- ❌ 禁止引入 CDN / 远程字体 / 外部 API
- ❌ 禁止使用 `eval()` / `new Function()` 等危险函数
- ❌ 禁止在未实机验证的情况下启用新平台选择器
- ❌ 禁止移除公众号编辑器选择器的三级回退
- ❌ 禁止用 `alert()` 做交互反馈
- ❌ 禁止在代码中留 `console.log` 调试残留
- ❌ 禁止修改文件前不备份（`*.bak-<版本>`）

---

## 更新日志

### 2026-09-28 v1.0.4 弹窗交互修复（遮罩关闭 / 空内容无法编辑）

- **点击遮罩误关弹窗**：主弹窗遮罩上的 `overlay.addEventListener('click', e => { if (e.target === overlay) close(); })` 使得「点弹窗外围一圈」就关闭弹窗，其中正在编辑的 HTML 全部丢失。v1.0.4 移除该监听，关闭入口收敛为「取消」按钮与 Esc（`onDocKeydown`）；表格生成子窗口的遮罩点击仍只关自身，行为不变
- **空内容无法编辑（根因：编辑器宿主宽度退化为内容宽度）**：`.wx-ext-editor-wrap` 是 flex 容器，但直接子元素 `#wx-ext-cm-host` 未给尺寸，宽度按 `max-content` 计算 —— 编辑器为空时宿主塌缩到行号槽宽度（无头 Chrome 实测 **47px**，长行内容时才被撑到 868px）。于是编辑区右侧大片区域属于 `editorWrap` 背景，点击落不到 CodeMirror 上，既无光标也无法输入；内容非空时宿主被长行撑开，问题被掩盖，因此只在空内容 / 短内容时暴露
- **修复**：`styles.css` 给 `#wx-ext-cm-host` 显式尺寸 `flex: 1 1 auto; min-width: 0`（撑满编辑区 + 允许压缩，长行改由 CodeMirror 自己横向滚动，不再把宿主撑出面板被 `overflow:hidden` 裁掉）；`content.js` 再加一层兜底：`editorWrap` 上 mousedown 落在编辑区/宿主本体（而非 CM 内部已有路径）时 `preventDefault()` + `cmEditor.focus()`
- 验证：无头 Chrome 加载弹窗结构（真实 `styles.css`）比对宿主尺寸与面板中心点的 `elementFromPoint` —— 修复前空内容 `47px` / 命中 `editorWrap` / 无法聚焦；修复后 `390px` / 命中 CM 内部 / `hasFocus=true` 且输入生效。`node --check content.js|background.js|options.js` 与 `manifest.json` 解析通过
- 教训（通用）：**flex 容器的直接子元素不显式给尺寸 ≠ 宽度撑满**，宽度会退化为 `max-content`，而「内容为空」正是内容宽度最小的极端场景；此类缺陷只在空数据态暴露，回归必须覆盖空数据态

### 2026-09-28 v1.0.3 正文容器保护修复

- **读取路径带出容器标签**：`btnRead` 用 `editor.innerHTML` 取内容，若命中的元素是 `.rich_media_content`（或 `.mock-iframe-*` 包装）就会把 `view rich_media_content` / `ProseMirror` 容器整体带进弹窗，插回时形成容器嵌套。新增 `readEditorContent(editor)`（只取 `innerHTML` 内部内容 + `stripContainerWrappers` 剥离混入容器标签），`btnRead` 与双向同步 `watchEditorChanges` 统一改走该函数
- **插入路径可能写进容器标签**：新增 `stripContainerWrappers(html)` 在插入前与 `insertHtmlToProseMirror` 写入网关各兜一次，逐层解包 `.rich_media_content` / `.ProseMirror` / `.mock-iframe-document|body`（保留内部内容，上限 20 层）；有剥离时在弹窗提示「已剥离正文容器标签，只保留内部内容」
- **替换模式可能替换元素本身**：新增 `isInnerRange(range, editor)`，`buildInsertRange` 的替换分支明确只用 `selectNodeContents(editor)`（不再有 `selectNode(editor)` 语义），`append` 分支保存的选区与裸 DOM 兜底的 `workingRange` 都必须通过 `isInnerRange` 校验，越界（边界落到容器元素外）一律回退到「文末内部」安全范围，绝不删除/替换容器元素
- **选择器误命中容器**：`findEditorDetail` 加 `isProseMirrorEditor` 过滤，命中元素不是 ProseMirror 本体时继续向下回退，不再把 `.rich_media_content` 当编辑器操作
- 关键防回归点：`stripContainerWrappers` 未真正解包到容器时**原样返回入参**（`changed` 标记），杜绝 v1.0.1 那类「无条件 parse→serialize 往返改写正文」；近似类名（`not-ProseMirror-x`、`rich_media_content-wrap`）恒等通过
- 教训（通用）：**读写托管编辑器时必须区分「容器元素」与「容器内部内容」**；`innerHTML` 取回的是内部内容，但一旦上游选择器落到容器层级，或用户从页面复制带出容器标签，就会把容器结构写回去造成嵌套 —— 读、写两端都要有「内部内容」边界校验

### 2026-09-25 v1.0.2 插入位置错乱修复

- **插入位置错乱（顶坏页面标签结构）**：`buildInsertRange` 只改了 DOM 选区，而 ProseMirror 的 paste/replaceSelection 用的是它 state 里的 selection；`selectionchange` 由浏览器**异步**派发，设完选区立刻 dispatch paste，PM 读到的还是旧 selection（编辑器从未 focus 过时通常停在 doc 开头）→ 内容插到错误层级。新增 `primeEditorSelection()`：应用选区 → 等两拍 → 写入前再校准一次
- 不能用「选区是否完全相等」判断同步成功：PM 同步后会把选区**规范化回写**到等价但未必全等的位置，精确比对会 100% 误判。改为固定等待 + 校准
- 新增 `appendedAtTail()`：追加模式下校验内容确实落在文末（只比对插入文本末尾 80 字，避免编辑器规范化开头空白导致误判），不满足则返回 `misplaced`，弹窗**保留**并提示用户核对（避免用户以为没成功而重复插入）
- `doInsert` 拆为 `runInsert`（async）+ `doInsert`（同步外壳 catch），避免未处理的 Promise 拒绝静默失败
- 新增编辑器命中徽标 `#wx-ext-target-badge`（选择器级别 / 内容字数 / 悬停看元素路径；同级命中多个时变黄警告），用于诊断是否误命中预览副本或摘要框
- 教训（通用）：**托管型编辑器写入前，DOM 选区与其内部 selection 的同步是异步的**，写完立即触发变更必踩坑；同理，任何「写完马上读回比对」的校验都要考虑编辑器自己的规范化回写

### 2026-09-25 v1.0.1 插入链路修复

- **首次插入无效**：公众号正文 DOM 由 ProseMirror 托管，`appendChild`/`insertNode` 属外部 DOM 变更，会被 PM 用自身 state 重渲染抹掉。改为 `focus()` 激活 → `buildInsertRange` 定位光标 → paste 事件 → `execCommand('insertHTML')` → 裸 DOM 兜底三级通道；插入后比对 `innerHTML` 判断是否真正生效，未生效则返回 `unchanged` 并保留弹窗提示重试
- **读取后插入导致内容重复/标签错乱**：「读取」拉的是全文，插入却是追加语义。新增 `insertMode`（`append` / `replace`）与底部切换按钮 `#wx-ext-btn-mode`，读取后自动切 `replace`（全选后插入即整体替换）
- **插入内容乱码**：`sanitizeForWeChat` 原先无条件用 `DOMParser` 往返重序列化，会改写 `&nbsp;`、内联 SVG、`mp-*` 自定义标签、table 结构，并把 `&amp;` 二次转义成 `&amp;amp;`。改为仅在 `RISKY_NODE_RE` / `RISKY_ATTR_RE` 命中时才做 DOM 往返；标签闭合检查抽为纯文本逻辑 `collectTagBalanceWarnings`
- 教训（通用）：**托管型富文本编辑器（ProseMirror / Slate / Lexical）禁止直接改 DOM 插入内容**，必须走其原生变更通道；**不要对已合法的 HTML 做无条件的 parse→serialize 往返**

### 2026-08-25 版本重置

- 版本号统一回归 v1.0.0 作为当前基线，历史迭代功能已全部整合

### 2026-08-25 TDZ 修复

- 编辑器已存在时注入导致 `editorSyncObserver` TDZ 崩溃；教训：`let` 状态声明必须位于任何可能同步执行的回调之前

### 2026-08-25 创建

- 依据 LockPass 项目 AGENTS.md 结构，为本扩展项目建立开发规范
- 沉淀历史教训：类名选择器歧义、js-beautify 不可用、无构建链约束、公众号选择器回退策略
- 与右键菜单/设置页/双向同步/平台注册表实施同步对齐
