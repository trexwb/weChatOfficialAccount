/* ============================
   公众号HTML插入助手 — 设置页逻辑
   模板管理（重命名/删除/导出/导入/清空）+ 净化默认值
   数据与 content script 共享：chrome.storage.local
   ============================ */

'use strict';

const $ = (id) => document.getElementById(id);

/* ─── Toast 反馈 ─── */
let toastTimer = 0;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ─── 模板列表渲染 ─── */
async function refreshTemplates() {
  const { templates = [] } = await chrome.storage.local.get('templates');
  const list = $('tpl-list');
  list.innerHTML = '';
  if (!templates.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = '暂无模板 — 在公众号编辑页弹窗的「模板 ▾」中保存';
    list.appendChild(empty);
    return;
  }
  templates.forEach((t, i) => {
    const item = document.createElement('div');
    item.className = 'tpl-item';

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = t.name;
    name.title = t.html.slice(0, 120);

    const ops = document.createElement('span');
    ops.className = 'ops';

    const btnRename = document.createElement('button');
    btnRename.className = 'btn';
    btnRename.textContent = '重命名';
    btnRename.addEventListener('click', async () => {
      const newName = window.prompt('模板名称：', t.name);
      if (!newName || newName === t.name) return;
      const { templates: list = [] } = await chrome.storage.local.get('templates');
      if (list[i]) {
        list[i].name = newName;
        await chrome.storage.local.set({ templates: list });
        toast('已重命名');
        refreshTemplates();
      }
    });

    const btnDel = document.createElement('button');
    btnDel.className = 'btn danger';
    btnDel.textContent = '删除';
    btnDel.addEventListener('click', async () => {
      if (!window.confirm(`删除模板「${t.name}」？`)) return;
      const { templates: list = [] } = await chrome.storage.local.get('templates');
      list.splice(i, 1);
      await chrome.storage.local.set({ templates: list });
      toast('已删除');
      refreshTemplates();
    });

    ops.appendChild(btnRename);
    ops.appendChild(btnDel);
    item.appendChild(name);
    item.appendChild(ops);
    list.appendChild(item);
  });
}

/* ─── 导出 / 导入 / 清空 ─── */
$('btn-export').addEventListener('click', async () => {
  const data = await chrome.storage.local.get(null);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `wx-ext-templates-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('已导出');
});

$('btn-import').addEventListener('click', () => $('file-import').click());

$('file-import').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const templates = Array.isArray(data.templates)
      ? data.templates.filter((t) => t && typeof t.name === 'string' && typeof t.html === 'string')
      : [];
    if (!templates.length) {
      toast('文件中没有有效模板');
      return;
    }
    // 合并：同名覆盖，其余追加
    const { templates: existing = [] } = await chrome.storage.local.get('templates');
    const merged = [...existing];
    templates.forEach((t) => {
      const idx = merged.findIndex((m) => m.name === t.name);
      if (idx >= 0) merged[idx] = t; else merged.push(t);
    });
    await chrome.storage.local.set({ templates: merged });
    toast(`已导入 ${templates.length} 个模板`);
    refreshTemplates();
  } catch {
    toast('导入失败：文件格式不正确');
  }
});

$('btn-clear').addEventListener('click', async () => {
  if (!window.confirm('确定清空全部模板？此操作不可撤销。')) return;
  await chrome.storage.local.set({ templates: [] });
  toast('已清空');
  refreshTemplates();
});

/* ─── 净化默认值 ─── */
const sanitizeSwitch = $('sanitize-default');
chrome.storage.local.get('sanitizeDefault', ({ sanitizeDefault }) => {
  sanitizeSwitch.checked = sanitizeDefault !== false; // 默认 true
});
sanitizeSwitch.addEventListener('change', () => {
  chrome.storage.local.set({ sanitizeDefault: sanitizeSwitch.checked });
  toast(sanitizeSwitch.checked ? '净化已默认开启' : '净化已默认关闭');
});

/* ─── 版本信息 ─── */
$('ver').textContent = `v${chrome.runtime.getManifest().version} · 设置`;

refreshTemplates();
