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
- [ ] 纯函数（formatHtml/minifyHtml/parseDelimited/sanitizeForWeChat）用 node 内联脚本跑一轮边界用例（含引号 CSV、pre 保留、未闭合标签）

### 浏览器手动验证（公众号编辑页）

- [ ] 悬浮按钮出现，编辑器就绪后提示变为「插入 HTML」
- [ ] 弹窗打开：CodeMirror 高亮/行号/括号匹配正常，Tab 缩进、Cmd/Ctrl+F 查找可用
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

### 2026-08-25 版本重置

- 版本号统一回归 v1.0.0 作为当前基线，历史迭代功能已全部整合

### 2026-08-25 TDZ 修复

- 编辑器已存在时注入导致 `editorSyncObserver` TDZ 崩溃；教训：`let` 状态声明必须位于任何可能同步执行的回调之前

### 2026-08-25 创建

- 依据 LockPass 项目 AGENTS.md 结构，为本扩展项目建立开发规范
- 沉淀历史教训：类名选择器歧义、js-beautify 不可用、无构建链约束、公众号选择器回退策略
- 与右键菜单/设置页/双向同步/平台注册表实施同步对齐
