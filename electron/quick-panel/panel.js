const $ = id => document.getElementById(id);
const input = document.querySelector("form input");
const results = $("results");
const modes = ["search", "ask"];
const list = key => $(key === "search" ? "rows" : "refs");
const state = () => ({ draft: "", caret: 0, scroll: 0, selected: -1, query: "", kind: "", pending: false, detail: null });
let citations = [];
let views = { search: state(), ask: state() };
let mode = "search", timer, composing = false, writing = false, saving = false, draftId = "", saveMessage = "";

function resize() {
  const expanded = !$("side").hidden;
  const left = $("content").getBoundingClientRect().height;
  const right = expanded ? $("side").children[0].offsetHeight + (writing ? 275 : $("reader").scrollHeight) : 0;
  const solo = writing && !views[mode].query;
  document.body.classList.toggle("solo-compose", solo);
  window.palette.height(Math.max(left, right), expanded && !solo);
}
new ResizeObserver(resize).observe($("content"));
new ResizeObserver(resize).observe($("note-body"));

function choose(key, index) {
  const buttons = list(key).querySelectorAll("button");
  views[key].selected = index;
  buttons.forEach((row, i) => row.setAttribute("aria-selected", String(i === index)));
  if (key !== mode) return;
  if (buttons[index]) input.setAttribute("aria-activedescendant", buttons[index].id);
  else input.removeAttribute("aria-activedescendant");
}
function updateListAccess() {
  input.setAttribute("aria-controls", list(mode).id);
  input.setAttribute("aria-expanded", String(!!list(mode).childElementCount));
  choose(mode, views[mode].selected);
}
function drawRows(key, data) {
  const box = list(key);
  box.replaceChildren();
  if (key === "ask") {
    $("sources").hidden = !data.length;
    $("ref-count").textContent = String(data.length);
  }
  for (const [i, row] of data.entries()) {
    const button = document.createElement("button");
    button.type = "button";
    button.id = key + "-item-" + i;
    button.setAttribute("role", "option");
    button.className = "row";
    const title = document.createElement("span");
    title.className = "row-title";
    title.textContent = row.title || "无标题笔记";
    button.title = title.textContent;
    button.append(title);
    const date = row.updatedAt && new Date(/^[0-9-]+ [0-9:]+$/.test(row.updatedAt) ? row.updatedAt.replace(" ", "T") + "Z" : row.updatedAt);
    const meta = [row.notebook, date && !isNaN(date.valueOf()) ? date.toLocaleDateString("zh-CN") : ""].filter(Boolean);
    for (const [text, cls] of [[row.snippet && row.snippet !== row.title ? row.snippet : "", "snippet"], [meta.join(" · "), "meta"]]) {
      if (!text) continue;
      const span = document.createElement("span");
      span.className = cls;
      span.textContent = text;
      button.append(span);
    }
    button.onclick = () => {
      choose(key, i);
      showNote(row.id, title.textContent);
    };
    box.append(button);
  }
  choose(key, -1);
  if (key === mode) updateListAccess();
}
// Keep completed Markdown blocks mounted while a later paragraph or table is growing.
function renderAnswer(html) {
  const answer = $("answer");
  const next = document.createElement("template");
  next.innerHTML = html;
  let old = answer.firstChild;
  while (old && next.content.firstChild && old.isEqualNode(next.content.firstChild)) {
    old = old.nextSibling;
    next.content.firstChild.remove();
  }
  while (old) {
    const following = old.nextSibling;
    old.remove();
    old = following;
  }
  answer.append(next.content);
}
function showNote(id, title) {
  stopRestoring();
  writing = false;
  if (views[mode].detail?.id !== id) {
    views[mode].detail = { id, title, html: "", notice: "正在读取…", loaded: false, scroll: 0 };
  }
  drawSide();
  if (!views[mode].detail.loaded) window.palette.submit("detail", id);
}
function drawSide() {
  const note = views[mode].detail;
  $("side").hidden = !writing && !note;
  $("compose").hidden = !writing;
  $("reader").hidden = writing;
  $("open-app").hidden = writing || !note;
  $("side-label").textContent = writing ? "新建笔记" : note?.folder ? "已存入 " + note.folder : "笔记详情";
  $("side-label").title = $("side-label").textContent;
  $("close-side").setAttribute("aria-label", writing ? "收起新建笔记" : "收起详情");
  $("note-title").textContent = note?.title || "";
  // HTML is restricted to inert formatting elements in quickPanelPreview.ts.
  $("note-body").innerHTML = note?.html || "";
  $("notice").textContent = note?.notice || "";
  $("reader").scrollTop = note?.scroll || 0;
  document.body.classList.toggle("expanded", !$("side").hidden);
  resize();
}
function closeSide() {
  if (writing) writing = false;
  else views[mode].detail = null;
  drawSide();
  input.focus();
}
$("close-side").onclick = closeSide;
$("open-app").onclick = () => { if (views[mode].detail) window.palette.submit("open", views[mode].detail.id); };
function updateComposer() {
  $("note-name").disabled = $("note-text").disabled = saving;
  $("save").disabled = $("organize").disabled = !!saving || !$("note-text").value.trim();
  $("save-status").textContent = saving === "organize" ? "正在归类…" : saving ? "正在保存…" : saveMessage;
}
function noteDraft() {
  return { id: draftId, title: $("note-name").value, text: $("note-text").value };
}
function editDraft() {
  saveMessage = "";
  window.palette.draft(noteDraft());
  updateComposer();
}
$("note-name").oninput = $("note-text").oninput = editDraft;
$("new").onclick = () => {
  if (!writing && views[mode].detail) views[mode].detail.scroll = $("reader").scrollTop;
  writing = true;
  drawSide();
  updateComposer();
  $("note-text").focus();
};
function saveDraft(action) {
  if (saving || !$("note-text").value.trim()) return;
  window.palette.draft(noteDraft());
  saving = action;
  updateComposer();
  window.palette.submit(action, draftId);
}
$("save").onclick = () => saveDraft("save");
$("organize").onclick = () => saveDraft("organize");

// Native window bounds change after IPC. Reapply the reading position after the
// resulting reflow, before the user starts interacting with the new mode.
let restoreScroll;
function stopRestoring() { restoreScroll = undefined; }
for (const event of ["wheel", "pointerdown", "keydown", "touchstart"]) document.addEventListener(event, stopRestoring, true);
window.addEventListener("resize", () => restoreScroll?.());

function showMode(next) {
  if (mode !== next) {
    const prev = views[mode];
    prev.draft = input.value;
    prev.caret = input.selectionStart ?? input.value.length;
    prev.scroll = results.scrollTop;
    if (prev.detail && !writing) prev.detail.scroll = $("reader").scrollTop;
    mode = next;
    writing = false;
    input.maxLength = mode === "search" ? 512 : 2000;
    input.value = views[mode].draft;
    input.setSelectionRange(views[mode].caret, views[mode].caret);
    drawSide();
    if (views[mode].detail && !views[mode].detail.loaded) window.palette.submit("detail", views[mode].detail.id);
  }
  for (const key of modes) {
    $(key).setAttribute("aria-pressed", String(mode === key));
    $(key + "-view").hidden = key !== mode;
  }
  const label = mode === "search" ? "搜索笔记" : "向笔记提问";
  input.placeholder = label + "…";
  input.setAttribute("aria-label", label);
  updateListAccess();
  input.focus();
  const view = views[mode];
  restoreScroll = () => {
    results.scrollTop = view.scroll;
    if (view.detail && !writing) $("reader").scrollTop = view.detail.scroll;
  };
  restoreScroll();
  resize();
}
for (const key of modes) $(key).onclick = () => {
  if (key === mode) { input.focus(); return; }
  showMode(key);
};
function inputChanged() {
  const v = views[mode];
  v.draft = input.value;
  if (mode !== "search") { choose(mode, -1); return; }
  clearTimeout(timer);
  v.query = input.value.trim();
  v.kind = "preview";
  v.pending = false;
  v.detail = null;
  if (!writing) drawSide();
  const status = $("search-status");
  const refining = list("search").childElementCount > 0 || !!status.textContent;
  status.textContent = v.query && refining ? "正在搜索…" : "";
  drawRows("search", []);
  window.palette.query("");
  if (!composing && v.query) timer = setTimeout(() => window.palette.query(v.query), 100);
}
input.oncompositionstart = () => { composing = true; };
input.oncompositionend = () => { composing = false; inputChanged(); };
input.oninput = inputChanged;
document.querySelector("form").onsubmit = event => {
  event.preventDefault();
  if (composing) return;
  const v = views[mode], text = input.value.trim();
  const selected = list(mode).children[v.selected];
  if (selected) return selected.click();
  if (!text || v.pending && v.query === text) return;
  if (mode === "ask" && text === v.query && $("answer").textContent && !$("ask-status").textContent) return;
  if (mode === "search") clearTimeout(timer);
  v.query = text;
  v.kind = mode;
  v.pending = true;
  v.detail = null;
  if (!writing) drawSide();
  drawRows(mode, []);
  results.scrollTop = 0;
  if (mode === "ask") {
    citations = [];
    $("question").textContent = text;
    $("answer").replaceChildren();
    $("answer-label").hidden = true;
  }
  $(mode + "-status").textContent = mode === "ask" ? "正在检索笔记…" : "正在搜索…";
  window.palette.submit(mode, text);
};
document.onkeydown = event => {
  if (composing || event.isComposing || event.keyCode === 229) return;
  if (event.key === "Escape") {
    if (!$("side").hidden) closeSide();
    else window.palette.submit("hide");
    return;
  }
  if (writing && (event.metaKey || event.ctrlKey) && event.key === "Enter" && $("compose").contains(event.target)) {
    event.preventDefault(); $("save").click(); return;
  }
  const buttons = list(mode).children;
  if (event.target !== input || !buttons.length || !["ArrowDown", "ArrowUp"].includes(event.key)) return;
  event.preventDefault();
  const old = views[mode].selected;
  const next = event.key === "ArrowDown" ? (old + 1) % buttons.length : (old <= 0 ? buttons.length - 1 : old - 1);
  choose(mode, next);
  buttons[next].scrollIntoView({ block: "nearest" });
};

function reset(session = {}) {
  clearTimeout(timer);
  citations = [];
  views = { search: state(), ask: state() };
  mode = "search"; writing = false; composing = false; saving = session.saving || false;
  saveMessage = ""; draftId = session.draft?.id || crypto.randomUUID();
  $("note-name").value = session.draft?.title || "";
  $("note-text").value = session.draft?.text || "";
  input.value = ""; input.maxLength = 512;
  for (const key of modes) { list(key).replaceChildren(); $(key + "-status").textContent = ""; }
  $("question").textContent = "";
  $("answer").replaceChildren(); $("sources").hidden = $("answer-label").hidden = true;
  drawSide(); updateComposer(); showMode("search");
}
window.palette.onClear(() => reset());
window.palette.onReset(reset);
window.palette.onResults(data => {
  if (data.kind === "save" && data.query === draftId) {
    saving = false;
    if (data.saved) {
      draftId = crypto.randomUUID(); $("note-name").value = ""; $("note-text").value = "";
      saveMessage = "";
      if (writing) {
        showNote(data.saved, "已保存的笔记");
        views[mode].detail.folder = data.folder;
        drawSide();
      }
    } else saveMessage = data.error || "保存失败，请重试";
    updateComposer();
    return;
  }
  if (data.kind === "detail") {
    for (const key of modes) {
      const note = views[key].detail;
      if (!note || note.id !== data.query) continue;
      Object.assign(note, data.detail || { notice: data.error || "无法读取笔记" }, { loaded: !!data.detail });
      if (key === mode && !writing) drawSide();
    }
    return;
  }
  const key = data.kind === "ask" ? "ask" : "search";
  const v = views[key];
  if (data.kind !== v.kind || data.query !== v.query || !v.query) return;
  if (data.error) {
    v.pending = false;
    if (key === "ask") {
      citations = [];
      $("answer-label").textContent = "部分回答";
    }
    $(key + "-status").textContent = data.error;
  } else if (typeof data.answerHtml === "string") {
    $("ask-status").textContent = data.done && !data.answerHtml ? "没有找到相关笔记，试试笔记里的关键词。" : "";
    $("answer-label").hidden = !data.answerHtml;
    $("answer-label").textContent = data.done ? "AI 回答" : "正在回答…";
    renderAnswer(data.answerHtml);
    if (data.done) {
      v.pending = false;
      if (data.answerHtml) drawRows("ask", citations);
      citations = [];
    }
  } else if (data.rows) {
    if (key === "ask") {
      citations = data.rows;
      if (citations.length) $("ask-status").textContent = "正在整理回答…";
      return;
    }
    v.pending = false;
    $("search-status").textContent = data.rows.length ? "" : "没有找到匹配的笔记";
    drawRows(key, data.rows);
  }
});
