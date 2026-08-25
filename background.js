/* ============================
   公众号HTML插入助手 — 后台 Service Worker
   职责：右键菜单（全局）→ 把选中内容插入公众号编辑器
   当前页是编辑页 → 直接用；其他页面 → 查找已打开的编辑页标签并插入
   ============================ */

const MENU_ID = 'wx-ext-insert-selection';

// 动态注入文件清单（与 manifest.json content_scripts.js 保持同步）
const INJECT_FILES = [
  'lib/codemirror/codemirror.min.js',
  'lib/codemirror/xml.min.js',
  'lib/codemirror/javascript.min.js',
  'lib/codemirror/css.min.js',
  'lib/codemirror/htmlmixed.min.js',
  'lib/codemirror/dialog.min.js',
  'lib/codemirror/searchcursor.min.js',
  'lib/codemirror/search.min.js',
  'lib/codemirror/match-highlighter.min.js',
  'lib/codemirror/matchbrackets.min.js',
  'content.js'
];

// 幂等创建：先 removeAll 再 create，避免版本更新后重复 id 报错
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create(
      {
        id: MENU_ID,
        title: '插入选中内容到公众号编辑器',
        contexts: ['selection']
      },
      () => {
        if (chrome.runtime.lastError) {
          console.error('[wx-ext] 右键菜单创建失败:', chrome.runtime.lastError.message);
        } else {
          console.log('[wx-ext] 右键菜单已创建');
        }
      }
    );
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab) return;
  void insertToWeChatEditor(tab, info.selectionText || '');
});

// 跨页面插入：当前页是编辑页直接用；否则查找已打开的编辑页标签
async function insertToWeChatEditor(fromTab, html) {
  const fromUrl = fromTab.url || '';
  const isEditPage = /mp\.weixin\.qq\.com/.test(fromUrl) && /action=edit/.test(fromUrl);

  if (isEditPage) {
    // 当前页就是编辑页：直接发送（失败时自动注入重试）
    await sendOrInject(fromTab.id, html);
    return;
  }

  // 查找所有已打开的公众号编辑页标签（跨窗口），取最近活跃的
  let editTabs = [];
  try {
    const tabs = await chrome.tabs.query({ url: '*://mp.weixin.qq.com/cgi-bin/appmsg*' });
    editTabs = tabs.filter((t) => /action=edit/.test(t.url || ''));
  } catch (err) {
    console.error('[wx-ext] 查询编辑页标签失败:', (err && err.message) || err);
  }

  if (!editTabs.length) {
    console.error('[wx-ext] 未找到已打开的公众号编辑页（请先打开一篇文章的编辑页）');
    flashBadge(fromTab.id, '✗', '#d93025');
    return;
  }

  editTabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  const target = editTabs[0];
  console.log(`[wx-ext] 插入到编辑页标签: ${target.title || target.url}`);

  const ok = await sendOrInject(target.id, html);
  if (ok) {
    // 从其他页面插入时，自动切到编辑页标签让用户看到弹窗
    await chrome.tabs.update(target.id, { active: true });
  }
}

// 发送消息到目标标签；失败时动态注入 content script 后重试
async function sendOrInject(tabId, html) {
  let resp;
  try {
    resp = await chrome.tabs.sendMessage(tabId, { type: 'WX_EXT_INSERT', html });
  } catch (err) {
    console.warn('[wx-ext] 直接发送失败，尝试动态注入:', (err && err.message) || err);
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: INJECT_FILES });
      resp = await chrome.tabs.sendMessage(tabId, { type: 'WX_EXT_INSERT', html });
    } catch (err2) {
      console.error('[wx-ext] 自动注入失败:', (err2 && err2.message) || err2);
      flashBadge(tabId, '✗', '#d93025');
      return false;
    }
  }
  if (resp && resp.ok) {
    flashBadge(tabId, '✓', '#07c160');
    return true;
  }
  const reason = (resp && resp.error) || '页面未响应';
  console.error('[wx-ext] 右键插入失败:', reason);
  flashBadge(tabId, '!', '#d93025');
  return false;
}

// 工具栏徽标提示 3 秒后自动清除
function flashBadge(tabId, text, color) {
  chrome.action.setBadgeText({ tabId, text });
  chrome.action.setBadgeBackgroundColor({ tabId, color });
  setTimeout(() => {
    chrome.action.setBadgeText({ tabId, text: '' });
  }, 3000);
}
