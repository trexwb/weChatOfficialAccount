(function () {
  'use strict';

  // 幂等清理：扩展重载后旧页面残留的悬浮按钮/弹窗 DOM（其上下文已失效），
  // 动态注入或重复注入时先移除，避免出现重复按钮
  document.querySelectorAll('.wx-ext-float-btn, .wx-ext-modal-overlay').forEach((el) => el.remove());

  /* ══════════════════════════════════════
     平台配置注册表
     新增平台：manifest matches + all_frames + 实机验证选择器后在此登记
  ══════════════════════════════════════ */
  const PLATFORMS = [
    {
      id: 'wechat',
      name: '微信公众号',
      hostMatch: /^mp\.weixin\.qq\.com$/,
      isEditPage: () => /action=edit/.test(location.search),
      selectors: [
        '.mock-iframe-document .mock-iframe-body .view.rich_media_content div.ProseMirror[contenteditable="true"]',
        '.rich_media_content div.ProseMirror[contenteditable="true"]',
        'div.ProseMirror[contenteditable="true"]'
      ]
    }
    // 秀米(xiumi.us) / 135编辑器(135editor.com) 的编辑器位于 iframe 内，
    // 需 manifest 增加 matches + "all_frames": true，并登记实机验证过的选择器。
    // 未验证的选择器禁止启用（见 AGENTS.md「平台扩展规范」）。
  ];

  const platform = PLATFORMS.find((p) => p.hostMatch.test(location.hostname) && p.isEditPage());

  // 常驻消息响应器（在平台判定之前注册）：即使页面不是编辑页，后台也能收到明确回应
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.type !== 'WX_EXT_INSERT') return;
    if (!platform) {
      sendResponse({ ok: false, error: '当前页面不是公众号编辑页' });
      return;
    }
    try {
      if (activeCmEditor) {
        activeCmEditor.setValue(msg.html || '');
        activeCmEditor.focus();
      } else {
        showEditorModal();
        requestAnimationFrame(() => {
          if (activeCmEditor) {
            activeCmEditor.setValue(msg.html || '');
            activeCmEditor.focus();
          }
        });
      }
      sendResponse({ ok: true });
    } catch (err) {
      console.error('[wx-ext] 处理右键菜单指令失败:', err);
      sendResponse({ ok: false, error: String((err && err.message) || err) });
    }
  });

  if (!platform) return;

  const EDITOR_SELECTORS = platform.selectors;

  /* ══════════════════════════════════════
     常量与状态
  ══════════════════════════════════════ */

  const INDENT = '  ';
  const STORAGE_KEY = 'wx-ext-state-v1'; // 页面草稿（localStorage，随页面隔离）
  const VOID_TAGS = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'param', 'source', 'track', 'wbr'
  ]);

  // 页面级同步存储（草稿）
  const store = {
    get() {
      try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
      catch { return {}; }
    },
    set(patch) {
      const s = this.get();
      Object.assign(s, patch);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* 容量满时静默 */ }
    }
  };

  // 跨页面存储（模板/设置，与设置页共享）：chrome.storage.local
  // 扩展重载后旧页面上下文失效，chrome.* 调用会抛 "Extension context invalidated"：
  // 这里统一兜底为「失败但返回空数据 + 记录错误」，避免未捕获 Promise 拒绝
  let storageError = null;
  const remoteStore = {
    get() {
      return new Promise((resolve) => {
        try {
          chrome.storage.local.get(null, (data) => {
            if (chrome.runtime.lastError) {
              storageError = chrome.runtime.lastError.message;
              resolve({});
            } else {
              storageError = null;
              resolve(data || {});
            }
          });
        } catch (err) {
          storageError = String((err && err.message) || err);
          resolve({});
        }
      });
    },
    set(patch) {
      return new Promise((resolve) => {
        try {
          chrome.storage.local.set(patch, () => {
            storageError = chrome.runtime.lastError ? chrome.runtime.lastError.message : null;
            resolve();
          });
        } catch (err) {
          storageError = String((err && err.message) || err);
          resolve();
        }
      });
    },
    hasError() {
      return !!storageError;
    }
  };

  function findEditor() {
    for (const selector of EDITOR_SELECTORS) {
      const el = document.querySelector(selector);
      if (el) return el;
    }
    return null;
  }

  let activeCmEditor = null; // 当前打开弹窗的 CodeMirror 实例（双向同步/右键菜单用）

  // 编辑器双向同步状态（必须在任何可能同步执行的回调之前声明，避免 TDZ）
  let editorSyncObserver = null;
  let editorSyncTimer = 0;

  /* ══════════════════════════════════════
     HTML 工具：格式化 / 压缩 / 净化
  ══════════════════════════════════════ */

  // 轻量格式化：按标签嵌套缩进（无外部依赖）
  function formatHtml(html) {
    const cleaned = html.replace(/<!--[\s\S]*?-->/g, '');
    const tokens = cleaned.split(/(<[^>]+>)/).filter(Boolean);
    const out = [];
    let depth = 0;
    const pad = () => INDENT.repeat(depth);
    for (const tok of tokens) {
      const m = tok.match(/^<(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)([^>]*?)(\/?)>$/);
      if (m) {
        const isClose = m[1] === '/';
        const name = m[2].toLowerCase();
        const selfClose = m[4] === '/' || tok.endsWith('/>');
        if (isClose) {
          depth = Math.max(0, depth - 1);
          out.push(pad() + tok);
        } else if (selfClose || VOID_TAGS.has(name) || /^<!/.test(tok)) {
          out.push(pad() + tok);
        } else {
          out.push(pad() + tok);
          depth++;
        }
      } else {
        const text = tok.replace(/\s+/g, ' ').trim();
        if (text) out.push(pad() + text);
      }
    }
    return out.join('\n');
  }

  // 轻量压缩：保留 pre/textarea/script/style 内容，去注释与多余空白
  function minifyHtml(html) {
    const KEEP = /<(pre|textarea|script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
    const parts = [];
    let last = 0;
    let m;
    KEEP.lastIndex = 0;
    while ((m = KEEP.exec(html))) {
      parts.push([html.slice(last, m.index), true]);
      parts.push([m[0], false]);
      last = m.index + m[0].length;
    }
    parts.push([html.slice(last), true]);
    return parts.map(([seg, normal]) => (
      normal
        ? seg.replace(/<!--[\s\S]*?-->/g, '')
            .replace(/>\s+</g, '><')
            .replace(/\s{2,}/g, ' ')
            .trim()
        : seg
    )).join('');
  }

  // 公众号适配净化：移除脚本/事件属性，检查未闭合标签
  function sanitizeForWeChat(html) {
    const warnings = new Set();
    const doc = new DOMParser().parseFromString(html, 'text/html');

    doc.querySelectorAll('script, iframe, object, embed, link, meta, base, form').forEach((el) => {
      warnings.add(`已移除 <${el.tagName.toLowerCase()}>`);
      el.remove();
    });
    doc.querySelectorAll('*').forEach((el) => {
      [...el.attributes].forEach((attr) => {
        if (/^on/i.test(attr.name)) {
          warnings.add(`已移除事件属性 ${attr.name}`);
          el.removeAttribute(attr.name);
        }
      });
    });

    // 未闭合/多余闭合标签检查
    const openCount = {};
    const closeCount = {};
    const re = /<(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)\b/g;
    let m;
    while ((m = re.exec(html))) {
      const tag = m[2].toLowerCase();
      if (VOID_TAGS.has(tag)) continue;
      (m[1] === '/' ? closeCount : openCount)[tag] = ((m[1] === '/' ? closeCount : openCount)[tag] || 0) + 1;
    }
    for (const tag of Object.keys(openCount)) {
      const diff = (openCount[tag] || 0) - (closeCount[tag] || 0);
      if (diff > 0) warnings.add(`<${tag}> 可能未闭合（差 ${diff} 个）`);
      else if (diff < 0) warnings.add(`</${tag}> 多余（差 ${-diff} 个）`);
    }

    return { html: doc.body.innerHTML, warnings: [...warnings] };
  }

  // Excel/CSV → 表格 HTML
  function parseDelimited(text) {
    const delim = text.includes('\t') ? '\t' : ',';
    const rows = [];
    let row = [];
    let field = '';
    let inQuote = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuote) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else { inQuote = false; }
        } else { field += c; }
      } else if (c === '"') {
        inQuote = true;
      } else if (c === delim) {
        row.push(field); field = '';
      } else if (c === '\n') {
        row.push(field); rows.push(row); row = []; field = '';
      } else if (c !== '\r') {
        field += c;
      }
    }
    row.push(field);
    rows.push(row);
    return rows.filter((r) => r.some((f) => f.trim() !== ''));
  }

  function tableToHtml(rows, useHeader) {
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const thStyle = 'padding:8px 12px;border:1px solid #d9d9d9;background:#f2f2f2;font-weight:600;text-align:left;';
    const tdStyle = 'padding:8px 12px;border:1px solid #d9d9d9;';
    let out = '<section style="margin:0 0 20px;overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:14px;line-height:1.6;">';
    if (useHeader && rows.length) {
      out += '<thead><tr>' + rows[0].map((c) => `<th style="${thStyle}">${esc(c)}</th>`).join('') + '</tr></thead>';
      rows = rows.slice(1);
    }
    out += '<tbody>' + rows.map((r) => '<tr>' + r.map((c) => `<td style="${tdStyle}">${esc(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table></section>';
    return out;
  }

  /* ══════════════════════════════════════
     悬浮按钮
  ══════════════════════════════════════ */
  const floatBtn = document.createElement('div');
  floatBtn.className = 'wx-ext-float-btn';
  floatBtn.innerText = '✏️';
  floatBtn.title = '插入 HTML';
  floatBtn.setAttribute('aria-label', '插入 HTML');
  floatBtn.style.setProperty('--wx-ext-tip', '"等待编辑器…"');
  document.body.appendChild(floatBtn);

  waitForEditor(() => {
    floatBtn.classList.add('wx-ext-ready');
    floatBtn.style.setProperty('--wx-ext-tip', '"插入 HTML"');
    watchEditorChanges();
  });

  function waitForEditor(cb) {
    if (findEditor()) { cb(); return; }
    const mo = new MutationObserver(() => {
      if (findEditor()) { mo.disconnect(); cb(); }
    });
    mo.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { mo.disconnect(); cb(); }, 15000);
  }

  // 公众号编辑器外部变更 → 同步到已打开的弹窗（防抖，弹窗未开或已关则跳过，避免回环）
  function watchEditorChanges() {
    const editor = findEditor();
    if (!editor || editorSyncObserver) return;
    editorSyncObserver = new MutationObserver(() => {
      clearTimeout(editorSyncTimer);
      editorSyncTimer = setTimeout(() => {
        if (!activeCmEditor) return;
        const fresh = editor.innerHTML;
        if (activeCmEditor.getValue() !== fresh) {
          activeCmEditor.setValue(fresh);
        }
      }, 800);
    });
    editorSyncObserver.observe(editor, { childList: true, subtree: true, characterData: true });
  }

  // 打开弹窗前先记下编辑器内的选区，供「插入到光标处」使用；
  // preventDefault 避免点击按钮时编辑器选区被清除。
  let savedEditorRange = null;
  floatBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const sel = window.getSelection();
    if (sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      const editor = findEditor();
      if (editor && editor.contains(range.commonAncestorContainer)) {
        savedEditorRange = range.cloneRange();
        return;
      }
    }
    savedEditorRange = null;
  });
  floatBtn.addEventListener('click', showEditorModal);

  /* ══════════════════════════════════════
     编辑器弹窗
  ══════════════════════════════════════ */
  function showEditorModal() {
    if (document.querySelector('.wx-ext-modal-overlay')) return; // 防重复打开

    const overlay = document.createElement('div');
    overlay.className = 'wx-ext-modal-overlay';

    overlay.innerHTML = `
      <div class="wx-ext-modal">
        <!-- 标题栏 -->
        <div class="wx-ext-modal-header" title="拖动移动弹窗">
          <h3>插入 HTML 内容</h3>
          <div class="wx-ext-header-actions">
            <button class="wx-ext-btn-icon wx-ext-btn-read" title="读取页面编辑器当前内容">
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 5h14M3 10h14M3 15h8"/>
              </svg>
              读取
            </button>
          </div>
        </div>

        <!-- 标签页 -->
        <div class="wx-ext-tabs">
          <button class="wx-ext-tab" data-tab="editor">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="4 7 4 2 9 2 9 7"/><path d="M7 2L19 2 19 18 7 18 7 9 2 9 2 2"/>
            </svg>
            代码
          </button>
          <button class="wx-ext-tab" data-tab="preview">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M1 10s4-7 9-7 9 7 9 7-4 7-9 7-9-7-9-7z"/><circle cx="10" cy="10" r="3"/>
            </svg>
            预览
          </button>
          <button class="wx-ext-tab active" data-tab="split">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <rect x="1" y="2" width="18" height="16" rx="2"/>
              <line x1="10" y1="2" x2="10" y2="18"/>
            </svg>
            分屏
          </button>
        </div>

        <!-- 工具栏 -->
        <div class="wx-ext-toolbar">
          <div class="wx-ext-menu-wrap">
            <button class="wx-ext-tool-btn" id="wx-ext-btn-templates">模板 ▾</button>
            <div class="wx-ext-menu" id="wx-ext-menu" style="display:none"></div>
          </div>
          <button class="wx-ext-tool-btn" id="wx-ext-btn-format" title="格式化代码">格式化</button>
          <button class="wx-ext-tool-btn" id="wx-ext-btn-minify" title="压缩代码体积">压缩</button>
          <button class="wx-ext-tool-btn" id="wx-ext-btn-csv" title="粘贴 Excel/CSV 生成表格">表格生成</button>
          <span class="wx-ext-toolbar-spacer"></span>
          <button class="wx-ext-tool-btn active" id="wx-ext-btn-sanitize" title="插入时移除脚本/事件属性并检查标签闭合">净化</button>
        </div>

        <!-- 编辑区 -->
        <div class="wx-ext-body">
          <div class="wx-ext-editor-wrap">
            <div id="wx-ext-cm-host"></div>
          </div>
          <div class="wx-ext-preview-pane" id="wx-ext-preview" style="display:none"></div>
        </div>

        <!-- 表格生成子弹窗 -->
        <div class="wx-ext-subdialog" id="wx-ext-csv-dialog" style="display:none">
          <div class="wx-ext-subdialog-box">
            <h4>从 Excel / CSV 生成表格</h4>
            <textarea id="wx-ext-csv-input" spellcheck="false" placeholder="在 Excel 中选中区域后复制（Ctrl/Cmd+C），直接粘贴到这里；或粘贴 CSV 文本。&#10;&#10;支持 Tab 或逗号分隔，自动跳过空行。"></textarea>
            <label><input type="checkbox" id="wx-ext-csv-header" checked> 首行作为表头</label>
            <div class="wx-ext-subdialog-actions">
              <button class="wx-ext-btn-csv-cancel" id="wx-ext-csv-cancel">取消</button>
              <button class="wx-ext-btn-confirm" id="wx-ext-csv-ok">生成并插入</button>
            </div>
          </div>
        </div>

        <!-- 底部栏 -->
        <div class="wx-ext-modal-footer">
          <div class="wx-ext-meta">
            <span class="wx-ext-count">
              <span id="wx-ext-char-count">0</span> 字符
              &nbsp;·&nbsp;
              <span id="wx-ext-line-count">1</span> 行
            </span>
            <span class="wx-ext-hint">
              <kbd>Tab</kbd> 缩进 &nbsp;
              <kbd id="wx-ext-find-kbd">⌘F</kbd> 查找 &nbsp;
              <kbd id="wx-ext-mod-kbd">⌘↵</kbd> 插入 &nbsp;
              <kbd>Esc</kbd> 关闭
            </span>
          </div>
          <div class="wx-ext-modal-actions">
            <button class="wx-ext-btn-cancel" id="wx-ext-btn-cancel">取消</button>
            <button class="wx-ext-btn-confirm" id="wx-ext-btn-insert">插入到编辑器</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    /* ─── 元素引用（唯一控件一律用 id 绑定） ─── */
    const modal        = overlay.querySelector('.wx-ext-modal');
    const header       = overlay.querySelector('.wx-ext-modal-header');
    const cmHost       = overlay.querySelector('#wx-ext-cm-host');
    const previewPane  = overlay.querySelector('#wx-ext-preview');
    const charCount    = overlay.querySelector('#wx-ext-char-count');
    const lineCount    = overlay.querySelector('#wx-ext-line-count');
    const tabs         = overlay.querySelectorAll('.wx-ext-tab');
    const btnCancel    = overlay.querySelector('#wx-ext-btn-cancel');
    const btnInsert    = overlay.querySelector('#wx-ext-btn-insert');
    const btnRead      = overlay.querySelector('.wx-ext-btn-read');
    const btnTemplates = overlay.querySelector('#wx-ext-btn-templates');
    const templateMenu = overlay.querySelector('#wx-ext-menu');
    const btnFormat    = overlay.querySelector('#wx-ext-btn-format');
    const btnMinify    = overlay.querySelector('#wx-ext-btn-minify');
    const btnCsv       = overlay.querySelector('#wx-ext-btn-csv');
    const btnSanitize  = overlay.querySelector('#wx-ext-btn-sanitize');
    const csvDialog    = overlay.querySelector('#wx-ext-csv-dialog');
    const csvInput     = overlay.querySelector('#wx-ext-csv-input');
    const csvHeader    = overlay.querySelector('#wx-ext-csv-header');
    const csvCancel    = overlay.querySelector('#wx-ext-csv-cancel');
    const csvOk        = overlay.querySelector('#wx-ext-csv-ok');
    const editorWrap   = cmHost.parentElement;

    // 平台差异快捷键提示
    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
    overlay.querySelector('#wx-ext-mod-kbd').textContent = isMac ? '⌘↵' : 'Ctrl+Enter';
    overlay.querySelector('#wx-ext-find-kbd').textContent = isMac ? '⌘F' : 'Ctrl+F';

    /* ─── 初始化为分屏视图 ─── */
    tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === 'split'));
    editorWrap.style.display = 'flex';
    previewPane.style.display = 'block';

    /* ─── CodeMirror 编辑器 ─── */
    const cmEditor = CodeMirror(cmHost, {
      value: '',
      mode: 'htmlmixed',
      lineNumbers: true,
      indentUnit: 2,
      tabSize: 2,
      indentWithTabs: false,
      matchBrackets: true,
      highlightSelectionMatches: true,
      extraKeys: {
        'Esc': close,
        'Cmd-Enter': doInsert,
        'Ctrl-Enter': doInsert
      }
    });
    activeCmEditor = cmEditor;

    // 恢复草稿
    const savedDraft = store.get().draft;
    if (savedDraft) {
      cmEditor.setValue(savedDraft);
    }

    /* ─── 预览同步（防抖） ─── */
    let previewTimer = 0;
    function syncPreview() {
      clearTimeout(previewTimer);
      previewTimer = setTimeout(() => {
        if (previewPane.style.display !== 'none') {
          previewPane.innerHTML = cmEditor.getValue();
        }
      }, 150);
    }

    /* ─── 草稿自动保存（防抖） ─── */
    let draftTimer = 0;
    function scheduleDraftSave() {
      clearTimeout(draftTimer);
      draftTimer = setTimeout(() => store.set({ draft: cmEditor.getValue() }), 400);
    }

    cmEditor.on('change', () => {
      const val = cmEditor.getValue();
      charCount.textContent = val.length;
      lineCount.textContent = cmEditor.lineCount();
      syncPreview();
      scheduleDraftSave();
    });

    /* ─── 标签页切换 ─── */
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        tabs.forEach((t) => t.classList.toggle('active', t === tab));
        const name = tab.dataset.tab;
        editorWrap.style.display = name === 'preview' ? 'none' : 'flex';
        previewPane.style.display = name === 'editor' ? 'none' : 'block';
        if (name !== 'editor') previewPane.innerHTML = cmEditor.getValue();
        cmEditor.refresh();
      });
    });

    /* ─── 全局 Esc（搜索框/表格子窗口打开时优先关闭它们） ─── */
    const onDocKeydown = (e) => {
      if (e.key !== 'Escape') return;
      if (overlay.querySelector('.CodeMirror-dialog')) return; // 先关闭搜索框
      if (csvDialog.style.display !== 'none') { // 先关闭表格生成子窗口
        csvDialog.style.display = 'none';
        return;
      }
      close();
    };
    document.addEventListener('keydown', onDocKeydown);

    /* ─── 模板菜单（数据来自 chrome.storage.local，与设置页共享） ─── */
    async function renderTemplateMenu(mode) {
      const data = await remoteStore.get();
      if (remoteStore.hasError()) {
        showInlineMsg(overlay, '扩展已更新，请刷新页面后重试', 'error');
        return;
      }
      const { templates = [] } = data;
      templateMenu.innerHTML = '';
      templateMenu.style.display = 'block';
      const addItem = (text, onClick, extra) => {
        const item = document.createElement('div');
        item.className = 'wx-ext-menu-item';
        const label = document.createElement('span');
        label.textContent = text;
        item.appendChild(label);
        if (extra) item.appendChild(extra);
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          onClick();
        });
        templateMenu.appendChild(item);
      };
      if (mode === 'main') {
        addItem('保存当前内容为模板…', saveAsTemplate);
        addItem('管理模板…', () => renderTemplateMenu('manage'));
        if (templates.length) {
          const sep = document.createElement('div');
          sep.className = 'wx-ext-menu-sep';
          templateMenu.appendChild(sep);
        }
        templates.forEach((t, i) => addItem(t.name, () => insertTemplate(i)));
      } else {
        if (!templates.length) {
          addItem('（暂无模板）', () => {});
        }
        templates.forEach((t, i) => {
          const del = document.createElement('span');
          del.className = 'del';
          del.textContent = '删除';
          del.addEventListener('click', async (e) => {
            e.stopPropagation();
            const { templates: list = [] } = await remoteStore.get();
            if (remoteStore.hasError()) return;
            list.splice(i, 1);
            await remoteStore.set({ templates: list });
            renderTemplateMenu('manage');
          });
          addItem(t.name, () => {}, del);
        });
        const sep = document.createElement('div');
        sep.className = 'wx-ext-menu-sep';
        templateMenu.appendChild(sep);
        addItem('完成', () => { templateMenu.style.display = 'none'; });
      }
    }

    async function saveAsTemplate() {
      const html = cmEditor.getValue().trim();
      if (!html) {
        showInlineMsg(overlay, '编辑器内容为空，无法保存为模板', 'error');
        return;
      }
      const name = window.prompt('模板名称：', '');
      if (!name) return;
      const { templates = [] } = await remoteStore.get();
      if (remoteStore.hasError()) {
        showInlineMsg(overlay, '扩展已更新，请刷新页面后重试', 'error');
        return;
      }
      templates.push({ name, html });
      await remoteStore.set({ templates });
      templateMenu.style.display = 'none';
      showInlineMsg(overlay, `已保存模板「${name}」`, 'success');
    }

    async function insertTemplate(i) {
      const { templates = [] } = await remoteStore.get();
      if (remoteStore.hasError()) {
        showInlineMsg(overlay, '扩展已更新，请刷新页面后重试', 'error');
        return;
      }
      const t = templates[i];
      if (!t) return;
      cmEditor.replaceRange(t.html, cmEditor.getCursor());
      cmEditor.focus();
      templateMenu.style.display = 'none';
      showInlineMsg(overlay, `已插入模板「${t.name}」`, 'success');
    }

    btnTemplates.addEventListener('click', (e) => {
      e.stopPropagation();
      if (templateMenu.style.display === 'block') {
        templateMenu.style.display = 'none';
      } else {
        renderTemplateMenu('main');
      }
    });
    document.addEventListener('click', () => { templateMenu.style.display = 'none'; });

    /* ─── 格式化 / 压缩 ─── */
    btnFormat.addEventListener('click', () => {
      cmEditor.setValue(formatHtml(cmEditor.getValue()));
      cmEditor.focus();
      showInlineMsg(overlay, '已格式化', 'success');
    });
    btnMinify.addEventListener('click', () => {
      cmEditor.setValue(minifyHtml(cmEditor.getValue()));
      cmEditor.focus();
      showInlineMsg(overlay, '已压缩', 'success');
    });

    /* ─── 净化开关（默认值来自设置页） ─── */
    let sanitizeOn = true;
    remoteStore.get().then((s) => {
      if (typeof s.sanitizeDefault === 'boolean') {
        sanitizeOn = s.sanitizeDefault;
        btnSanitize.classList.toggle('active', sanitizeOn);
      }
    });
    btnSanitize.addEventListener('click', () => {
      sanitizeOn = !sanitizeOn;
      btnSanitize.classList.toggle('active', sanitizeOn);
    });

    /* ─── 表格生成 ─── */
    btnCsv.addEventListener('click', () => {
      csvInput.value = '';
      csvDialog.style.display = 'flex';
      csvInput.focus();
    });
    csvCancel.addEventListener('click', () => { csvDialog.style.display = 'none'; });
    csvDialog.addEventListener('click', (e) => { if (e.target === csvDialog) csvDialog.style.display = 'none'; });
    csvOk.addEventListener('click', () => {
      const rows = parseDelimited(csvInput.value);
      if (!rows.length) {
        showInlineMsg(overlay, '未解析到有效数据，请检查粘贴内容', 'error');
        return;
      }
      const html = tableToHtml(rows, csvHeader.checked);
      cmEditor.replaceSelection(html);
      csvDialog.style.display = 'none';
      cmEditor.focus();
      showInlineMsg(overlay, `已生成 ${rows.length} 行表格`, 'success');
    });

    /* ─── 弹窗拖动 ─── */
    let dragState = null;
    header.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button, .wx-ext-tabs')) return;
      const rect = modal.getBoundingClientRect();
      modal.style.position = 'fixed';
      modal.style.left = `${rect.left}px`;
      modal.style.top = `${rect.top}px`;
      modal.style.margin = '0';
      dragState = { sx: e.clientX, sy: e.clientY, l: rect.left, t: rect.top };
      modal.classList.add('wx-ext-dragging');
      e.preventDefault();
    });
    const onPointerMove = (e) => {
      if (!dragState) return;
      modal.style.left = `${dragState.l + e.clientX - dragState.sx}px`;
      modal.style.top = `${dragState.t + e.clientY - dragState.sy}px`;
    };
    const onPointerUp = () => {
      dragState = null;
      modal.classList.remove('wx-ext-dragging');
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    /* ─── 读取页面编辑器内容 ─── */
    btnRead.addEventListener('click', () => {
      const editor = findEditor();
      if (!editor) {
        showInlineMsg(overlay, '未找到页面编辑器', 'error');
        return;
      }
      cmEditor.setValue(editor.innerHTML);
      showInlineMsg(overlay, '已读取当前编辑器内容', 'success');
    });

    /* ─── 按钮操作 ─── */
    btnCancel.addEventListener('click', close);
    btnInsert.addEventListener('click', doInsert);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    /* ─── 插入逻辑 ─── */
    function doInsert() {
      let html = cmEditor.getValue().trim();
      if (!html) {
        showInlineMsg(overlay, '请输入要插入的 HTML 内容', 'error');
        cmEditor.focus();
        return;
      }
      if (sanitizeOn) {
        const res = sanitizeForWeChat(html);
        html = res.html;
        if (res.warnings.length) {
          showInlineMsg(
            overlay,
            res.warnings.slice(0, 3).join('；') + (res.warnings.length > 3 ? ` 等 ${res.warnings.length} 条` : ''),
            'warn'
          );
        }
      }
      const result = insertHtmlToProseMirror(html);
      if (result === false) {
        showInlineMsg(overlay, '未找到公众号编辑器，请确保当前在文章编辑页面', 'error');
      } else {
        store.set({ draft: '' });
        close();
      }
    }

    function close() {
      if (!overlay.isConnected) return;
      activeCmEditor = null;
      document.removeEventListener('keydown', onDocKeydown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      overlay.classList.add('wx-ext-closing');
      const removeOverlay = () => overlay.remove();
      overlay.addEventListener('animationend', removeOverlay, { once: true });
      setTimeout(removeOverlay, 300); // 动画兜底（如系统开启减弱动态效果）
    }

    /* ─── 自动聚焦 ─── */
    requestAnimationFrame(() => {
      cmEditor.focus();
      cmEditor.setCursor(cmEditor.lineCount(), 0);
      cmEditor.refresh();
    });
  }

  /* ══════════════════════════════════════
     插入 HTML 到公众号编辑器
     - 有编辑器内选区 → 替换选区（全选即可整体替换）
     - 无选区 → 追加到文章末尾（不再清空已有内容）
  ══════════════════════════════════════ */
  function insertHtmlToProseMirror(html) {
    const targetEditor = findEditor();
    if (!targetEditor) return false;

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;

    const sel = window.getSelection();
    if (savedEditorRange && targetEditor.contains(savedEditorRange.commonAncestorContainer)) {
      // 替换选区
      const frag = document.createDocumentFragment();
      while (tempDiv.firstChild) frag.appendChild(tempDiv.firstChild);
      savedEditorRange.deleteContents();
      savedEditorRange.insertNode(frag);
      savedEditorRange.collapse(false);
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(savedEditorRange);
      }
    } else {
      // 追加到末尾
      while (tempDiv.firstChild) targetEditor.appendChild(tempDiv.firstChild);
      targetEditor.focus();
      const range = document.createRange();
      range.selectNodeContents(targetEditor);
      range.collapse(false);
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
    savedEditorRange = null;

    targetEditor.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  /* ─── 内联提示（替代 alert） ─── */
  function showInlineMsg(container, message, type) {
    const prev = container.querySelector('.wx-ext-toast');
    if (prev) prev.remove();
    const toast = document.createElement('div');
    toast.className = `wx-ext-toast wx-ext-toast-${type}`;
    toast.textContent = message;
    container.querySelector('.wx-ext-modal').appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('wx-ext-toast-show'));
    setTimeout(() => {
      toast.classList.remove('wx-ext-toast-show');
      setTimeout(() => toast.remove(), 250); // transitionend 兜底
    }, 2200);
  }
})();
