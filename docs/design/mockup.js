/* ============================================================
   MusicTag 界面草图 — 交互脚本（假数据）
   ============================================================ */

// ---------- 假数据 ----------
const SONGS = [
  { file: "床边故事.mp3",  title: "床边故事",  artist: "周杰伦", album: "周杰伦的床边故事", albumArtist: "周杰伦", track: "01", total: "12", year: "2016", genre: "华语流行" },
  { file: "告白气球.mp3",  title: "告白气球",  artist: "周杰伦", album: "周杰伦的床边故事", albumArtist: "周杰伦", track: "04", total: "12", year: "2016", genre: "华语流行" },
  { file: "等你下课.flac", title: "等你下课",  artist: "周杰伦", album: "", albumArtist: "", track: "", total: "", year: "2018", genre: "" },
  { file: "突然好想你.flac",title: "突然好想你",artist: "五月天", album: "后青春期的诗", albumArtist: "五月天", track: "07", total: "12", year: "2008", genre: "摇滚" },
  { file: "知足.mp3",     title: "知足",      artist: "五月天", album: "", albumArtist: "", track: "", total: "", year: "", genre: "" },
  { file: "倔强.mp3",     title: "倔强",      artist: "五月天", album: "神的孩子都在跳舞", albumArtist: "五月天", track: "06", total: "13", year: "2004", genre: "摇滚" },
  { file: "陪你熬夜.mp3",  title: "",         artist: "",     album: "", albumArtist: "", track: "", total: "", year: "", genre: "" },
];

const LYRIC = `[00:11.32] 你说你有点难追 想让我知难而退
[00:15.20] 礼物不需挑最贵 只要香榭的落叶
[00:19.30] 打造浪漫的约会 不害怕搞砸一切
[00:23.11] 拥有你就拥有全世界
[00:27.00] 告白气球 风吹到对街
[00:30.42] 微笑在天上飞`;

// 有标题标签的歌曲，展示标题；无标签的读文件名
function displayName(s) {
  const base = s.file.replace(/\.[^.]+$/, "");
  return s.title || base;
}

// ---------- DOM ----------
const $ = id => document.getElementById(id);

// ---------- 主题 ----------
// 手动切换：点按钮固定为主题，记忆到 localStorage；首次跟随系统
const stored = localStorage.getItem("theme");
const theme = stored || (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
if (stored) {
  document.documentElement.setAttribute("data-theme", theme);
}
const themeBtn = $("themeBtn");
function refreshThemeBtn() {
  const cur = document.documentElement.getAttribute("data-theme");
  const effective = cur || (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  themeBtn.textContent = effective === "light" ? "🌙" : "☀️";
}
themeBtn.addEventListener("click", () => {
  const cur = document.documentElement.getAttribute("data-theme");
  const next = cur === "light" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("theme", next);
  refreshThemeBtn();
});
refreshThemeBtn();

const list = $("songlist");
const editor = $("editor");
const empty = $("editorEmpty");
const overlay = $("overlay");

let selectedId = null;
let current = null;          // 正在编辑的歌（拷贝）
let original = null;         // 打开时的原始快照
let dirty = false;
let pendingId = null;        // 被切歌弹窗暂存的目标歌

// ---------- 渲染列表 ----------
function renderList(filter) {
  const kw = (filter || "").trim().toLowerCase();
  const shown = SONGS
    .filter(s => !kw || displayName(s).toLowerCase().includes(kw) || (s.artist || "").toLowerCase().includes(kw))
    .map((s, i) => ({ ...s, _id: i }));

  list.innerHTML = "";
  if (!shown.length) {
    const d = document.createElement("div");
    d.className = "songlist-empty";
    d.textContent = "没有匹配的歌曲";
    list.appendChild(d);
    return;
  }
  for (const s of shown) {
    const row = document.createElement("div");
    row.className = "song-row" + (s._id === selectedId ? " selected" : "");
    row.dataset.id = s._id;

    const name = document.createElement("span");
    name.className = "song-name";
    name.textContent = displayName(s);
    name.title = s.file;

    const artist = document.createElement("span");
    artist.className = "song-artist";
    artist.textContent = s.artist || "";

    row.appendChild(name);
    row.appendChild(artist);
    row.addEventListener("click", () => onRowClick(s._id));
    list.appendChild(row);
  }
}

// ---------- 编辑表单 ----------
function renderEditor(s) {
  original = JSON.parse(JSON.stringify(s));
  current = JSON.parse(JSON.stringify(s));
  dirty = false;

  editor.innerHTML = "";

  // 顶栏
  const bar = document.createElement("div");
  bar.className = "editor-bar";

  const now = document.createElement("div");
  now.className = "now";
  const nowTitle = document.createElement("span");
  nowTitle.className = "now-title";
  nowTitle.textContent = `正在编辑: ${s.file}`;
  const nowArtist = document.createElement("span");
  nowArtist.className = "now-artist";
  nowArtist.textContent = s.artist || "";
  now.append(nowTitle, nowArtist);

  const actions = document.createElement("div");
  actions.className = "editor-actions";
  const btnUndo = mkBtn("撤销", "btn-ghost", () => {
    revertToOriginal();
    syncState();
  });
  const btnSave = mkBtn("保存", "btn-primary", () => {
    saveNow();
    syncState();
  });
  actions.append(btnUndo, btnSave);

  const saveState = document.createElement("span");
  saveState.className = "save-state";
  saveState.id = "saveState";

  bar.append(now, saveState, actions);

  // 字段
  const body = document.createElement("div");
  body.className = "editor-body";

  const grid = document.createElement("div");
  grid.className = "fieldgrid";
  const fields = document.createElement("div");
  fields.className = "fields";

  const inputs = {};
  const defs = [
    { key: "title",       label: "歌名",     ph: "从文件名读取" },
    { key: "artist",      label: "作者",     ph: "未设置" },
    { key: "album",       label: "专辑",     ph: "未设置" },
    { key: "albumArtist", label: "专辑作者", ph: "未设置" },
  ];
  for (const d of defs) {
    const f = mkField(d.label, d.key, s[d.key], d.ph, inputs);
    fields.appendChild(f);
  }
  // 音轨号 / 共
  {
    const row = document.createElement("div");
    row.className = "field";
    const lab = document.createElement("span");
    lab.className = "field-label";
    lab.textContent = "音轨号";
    const wrap = document.createElement("div");
    wrap.className = "inline-suffix";
    const tr = document.createElement("input");
    tr.type = "text"; tr.value = s.track || ""; tr.placeholder = "–";
    const sep = document.createElement("span");
    sep.className = "tot"; sep.textContent = "/ 共";
    const tt = document.createElement("input");
    tt.type = "text"; tt.value = s.total || ""; tt.placeholder = "–";
    tt.style.width = "48px";
    wrap.append(tr, sep, tt);
    row.append(lab, wrap);
    inputs.track = tr; inputs.total = tt;
    fields.appendChild(row);
  }
  // 年份 / 流派 / 文件名
  const extra = [
    { key: "year",  label: "年份", ph: "未设置" },
    { key: "genre", label: "流派", ph: "未设置" },
    { key: "file",  label: "文件名", ph: s.file, isFile: true },
  ];
  for (const d of extra) {
    const f = mkField(d.label, d.key, d.isFile ? s.file : (s[d.key] || ""), d.ph, inputs);
    fields.appendChild(f);
  }

  // 封面
  const cover = document.createElement("div");
  cover.className = "cover";
  const box = document.createElement("div");
  box.className = "cover-box";
  box.innerHTML = '<div class="cover-mark">🖼</div><div class="cover-hint">点击选择图片<br>或拖拽嵌入</div>';
  const meta = document.createElement("div");
  meta.className = "cover-meta";
  meta.textContent = "JPEG / PNG · 跟随文件";
  const coverSearch = buildCoverSearch(cover);
  cover.append(box, meta, coverSearch);

  grid.append(fields, cover);

  // 歌词
  const ly = document.createElement("div");
  ly.className = "lyrics";
  const head = document.createElement("div");
  head.className = "lyrics-head";
  const lab = document.createElement("span");
  lab.className = "label"; lab.textContent = "歌词";
  const badge = document.createElement("span");
  badge.className = "badge"; badge.textContent = "来源: 内嵌标签";
  const cb = document.createElement("label");
  cb.className = "checkbox";
  const cbIn = document.createElement("input");
  cbIn.type = "checkbox"; cbIn.checked = true;
  const cbTxt = document.createElement("span");
  cbTxt.textContent = "同时保存为 .lrc";
  cb.append(cbIn, cbTxt);
  head.append(lab, badge, cb);

  const box2 = document.createElement("textarea");
  box2.className = "lyrics-box";
  box2.placeholder = "粘贴歌词，可带时间轴（[00:11.32] …）";
  box2.value = LYRIC;
  const lyricSearch = buildLyricSearch(box2);
  ly.append(head, lyricSearch, box2);

  body.append(grid, ly);
  editor.append(bar, body);

  // 事件
  for (const k of Object.keys(inputs)) {
    inputs[k].addEventListener("input", () => {
      current[k] = inputs[k].value;
      updateDirty();
      syncState();
    });
  }
  cbIn.addEventListener("change", updateDirty);
  box2.addEventListener("input", () => { current.lyric = box2.value; updateDirty(); syncState(); });
  box.addEventListener("click", () => { updateDirty(); syncState(); });
}

// ---------- 手动搜索候选区（封面 / 歌词） ----------
function mkSearchBtn(label, onClick) {
  const b = document.createElement("button");
  b.className = "search-trigger";
  b.textContent = "🔍 " + label;
  b.addEventListener("click", onClick);
  return b;
}

// 封面区：搜索按钮 + 候选缩略图网格
function buildCoverSearch(cover) {
  const s = document.createElement("div");
  s.className = "cover-search";
  s.appendChild(mkSearchBtn("搜索封面", () => {
    showCoverCandidates(s);
  }));
  return s;
}

function showCoverCandidates(container) {
  container.innerHTML = "";
  container.appendChild(mkSearchBtn("搜索封面", () => showCoverCandidates(container)));
  const status = document.createElement("div");
  status.className = "cand-status";
  status.textContent = "搜索中…";
  container.appendChild(status);
  // 模拟延迟后出候选
  setTimeout(() => {
    status.remove();
    const grid = document.createElement("div");
    grid.className = "cand-grid";
    const thumbs = [
      { src: "https://p1.music.126.net/WlQ8yqZmNLyWlBvVQdNoyw==/109951162900000000.jpg", label: "网易云" },
      { src: "https://y.qq.com/music/photo_new/T002R300x300M000004Q7FwZ2P8fO.jpg", label: "QQ音乐" },
      { src: "https://imgessl.kugou.com/stdmusic/20230706/20230706173729144953.jpg", label: "酷狗" },
      { src: "https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/00/00/00/00000000.jpg", label: "iTunes" },
    ];
    for (const t of thumbs) {
      const cell = document.createElement("div");
      cell.className = "cand-cell";
      cell.innerHTML = `<img src="${t.src}" alt="封面候选" loading="lazy"><span class="src-tag">${t.label}</span>`;
      cell.addEventListener("click", () => {
        // 点选 → 填入封面区预览
        const box = document.querySelector(".cover-box");
        const img = cell.querySelector("img");
        box.innerHTML = `<img src="${img.src}" alt="封面" style="width:100%;height:100%;object-fit:cover;border-radius:8px">`;
      });
      grid.appendChild(cell);
    }
    const tip = document.createElement("div");
    tip.className = "cand-empty";
    tip.textContent = "点选一张填入预览";
    container.append(grid, tip);
  }, 900);
}

// 歌词区：搜索按钮 + 候选条列表
function buildLyricSearch(lyricsBox) {
  const s = document.createElement("div");
  s.className = "lyric-search";
  s.appendChild(mkSearchBtn("搜索歌词", () => {
    showLyricCandidates(s, lyricsBox);
  }));
  return s;
}

function showLyricCandidates(container, lyricsBox) {
  container.innerHTML = "";
  container.appendChild(mkSearchBtn("搜索歌词", () => showLyricCandidates(container, lyricsBox)));
  const status = document.createElement("div");
  status.className = "cand-status";
  status.textContent = "搜索中…";
  container.appendChild(status);
  setTimeout(() => {
    status.remove();
    const cands = [
      { src: "网易云", title: "告白气球", artist: "周杰伦" },
      { src: "QQ音乐", title: "告白气球", artist: "周杰伦" },
    ];
    for (const c of cands) {
      const row = document.createElement("div");
      row.className = "cand-row";
      const tag = document.createElement("span");
      tag.className = "src-tag"; tag.textContent = c.src;
      const meta = document.createElement("span");
      meta.className = "cand-meta"; meta.textContent = `${c.title} — ${c.artist}`;
      row.append(tag, meta);
      row.addEventListener("click", () => {
        lyricsBox.value = LYRIC;
        lyricsBox.dispatchEvent(new Event("input"));
      });
      container.appendChild(row);
    }
  }, 900);
}

// ---------- 小工具 ----------
function mkBtn(text, cls, onClick) {
  const b = document.createElement("button");
  b.className = "btn " + cls;
  b.textContent = text;
  b.addEventListener("click", onClick);
  return b;
}
function mkField(label, key, value, ph, inputs) {
  const row = document.createElement("div");
  row.className = "field";
  const lab = document.createElement("span");
  lab.className = "field-label"; lab.textContent = label;
  const inp = document.createElement("input");
  inp.type = "text"; inp.value = value || ""; inp.placeholder = ph;
  inputs[key] = inp;
  row.append(lab, inp);
  return row;
}

function updateDirty() {
  if (!current || !original) return;
  dirty =
    current.title !== (original.title || "") ||
    current.artist !== (original.artist || "") ||
    current.album !== (original.album || "") ||
    current.albumArtist !== (original.albumArtist || "") ||
    (inputsNow && inputsNow.track && inputsNow.track.value !== (original.track || "")) ||
    (inputsNow && inputsNow.total && inputsNow.total.value !== (original.total || "")) ||
    current.year !== (original.year || "") ||
    current.genre !== (original.genre || "") ||
    current.file !== original.file ||
    current.lyric !== original.lyric;
}
let inputsNow = null;

function revertToOriginal() {
  if (!original) return;
  // 重新渲染编辑器，回到原始值
  renderEditor(original);
  document.querySelector(".editor-bar .now-title").textContent = `正在编辑: ${original.file}`;
}

function saveNow() {
  dirty = false;
  current.lyric = document.querySelector(".lyrics-box")?.value || "";
  const st = $("saveState");
  st.textContent = "✓ 已保存";
  st.className = "save-state saved";
}

function syncState() {
  const st = $("saveState");
  if (!st) return;
  if (dirty) {
    st.textContent = "有未保存的修改";
    st.className = "save-state dirty";
  } else {
    st.textContent = original ? "" : "";
    st.className = "save-state";
  }
}

// ---------- 切歌 / 弹窗 ----------
function onRowClick(id) {
  const next = SONGS[id];
  if (id === selectedId) return;

  if (dirty) {
    pendingId = id;
    overlay.hidden = false;
    document.getElementById("dialogTitle").textContent = `保存对 ${current.file} 的修改吗？`;
    return;
  }
  selectSong(id);
}

function selectSong(id) {
  selectedId = id;
  renderList($("search").value);
  renderEditor(SONGS[id]);
  $("saveState").textContent = "";
}

// 弹窗按钮
document.getElementById("dlgSave").addEventListener("click", () => {
  saveNow();
  overlay.hidden = true;
  selectSong(pendingId);
});
document.getElementById("dlgDiscard").addEventListener("click", () => {
  overlay.hidden = true;
  selectSong(pendingId);
});
document.getElementById("dlgCancel").addEventListener("click", () => {
  overlay.hidden = true;
  pendingId = null;
});
overlay.addEventListener("click", e => {
  if (e.target === overlay) { overlay.hidden = true; pendingId = null; }
});

// 搜索
$("search").addEventListener("input", e => renderList(e.target.value));

// 打开
$("openBtn").addEventListener("click", () => {
  $("pathBar").textContent = "路径: /Volumes/Music/周杰伦/";
});

// ---------- 启动 ----------
renderList("");
renderEditor(SONGS[1]);
selectedId = 1;
renderList("");
