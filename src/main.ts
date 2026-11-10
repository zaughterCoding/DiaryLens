import "./style.css";
import logoSvg from "./assets/logo.svg?raw";
import { isMock, loadSettings } from "./llm";
import { parseDiary } from "./parse";
import { emptyProject, getProject, isReadOnly, loadProject, pendingDates, replaceProject, subscribe, update, upsertEntries } from "./store";
import type { Project } from "./types";
import { confirmDialog, toast } from "./ui/modal";
import { openCategories } from "./ui/categories";
import { runAnalysis, isRunning } from "./ui/flow";
import { openImport } from "./ui/import";
import { openSettings } from "./ui/settings";
import { download, esc, toDateStr } from "./util";
import { mountCalendar } from "./views/calendar";
import { closePanel, initPanel, onSelect, refreshPanel } from "./views/detail";
import { mountEntries } from "./views/entries";
import { mountMood } from "./views/mood";
import { mountStats } from "./views/stats";
import { mountTimeline } from "./views/timeline";
import { mountWeekly } from "./views/weekly";

// 在应用改动 DOM 之前保存页面原样，用于「导出离线 HTML」时复制自身
const PRISTINE_HTML = "<!doctype html>\n" + document.documentElement.outerHTML;

// 图标以 data URI 注入，保证单文件打包和导出的离线 HTML 都带图标
const favicon = document.createElement("link");
favicon.rel = "icon";
favicon.type = "image/svg+xml";
favicon.href = "data:image/svg+xml," + encodeURIComponent(logoSvg);
document.head.appendChild(favicon);

const VIEWS = [
  { id: "timeline", name: "时间轴" },
  { id: "stats", name: "统计" },
  { id: "calendar", name: "日历" },
  { id: "mood", name: "状态" },
  { id: "weekly", name: "周报" },
  { id: "entries", name: "日记" },
] as const;
type ViewId = (typeof VIEWS)[number]["id"];

let view: ViewId = (VIEWS.find((v) => "#" + v.id === location.hash)?.id ?? "timeline") as ViewId;
let mounted: { refresh?: () => void; rerender?: () => void; destroy?: () => void } | null = null;

const app = document.getElementById("app")!;

function shell() {
  const ro = isReadOnly();
  app.innerHTML = `
    <header class="topbar">
      <span class="brand"><span class="logo">${logoSvg}</span>DiaryLens</span>
      <input class="pname" id="pname" value="${esc(getProject().name)}" title="项目名" ${ro ? "readonly" : ""}>
      <nav class="tabs" id="tabs">${VIEWS.map((v) => `<button data-view="${v.id}">${v.name}</button>`).join("")}</nav>
      <div class="actions" id="actions"></div>
    </header>
    <div id="banner"></div>
    <main><div class="view" id="view"></div></main>`;
  app.querySelector("#tabs")!.addEventListener("click", (e) => {
    const v = (e.target as HTMLElement).closest<HTMLElement>("[data-view]")?.dataset.view as ViewId | undefined;
    if (v) go(v);
  });
  const pname = app.querySelector<HTMLInputElement>("#pname")!;
  pname.addEventListener("change", () => update((p) => (p.name = pname.value.trim() || "我的日记")));
}

function renderActions() {
  const el = app.querySelector("#actions")!;
  if (isReadOnly()) {
    el.innerHTML = `<span class="muted" style="font-size:12px">只读快照 · 导出于 ${new Date(getProject().updatedAt).toLocaleDateString()}</span>`;
    return;
  }
  const p = getProject();
  const pending = pendingDates().length;
  const s = loadSettings();
  el.innerHTML = `
    <button class="btn" data-act="import">导入日记</button>
    <button class="btn ${p.categoriesLocked && pending ? "primary" : ""}" data-act="analyze" ${p.categoriesLocked && pending && !isRunning() ? "" : "disabled"}>分析${pending ? ` <span class="badge">${pending}</span>` : ""}</button>
    <button class="btn" data-act="cats" ${p.entries.length || p.categories.length ? "" : "disabled"}>分类</button>
    <div class="menu" id="more"><button class="btn" data-act="more">更多 ▾</button><div class="pop">
      <button data-act="export-html">导出离线 HTML<small>只读快照，双击即可打开分享</small></button>
      <button data-act="export-json">导出项目 JSON<small>完整备份，可在其他电脑导入</small></button>
      <button data-act="import-json">导入项目 JSON<small>会替换当前项目</small></button>
      <button data-act="sample">加载示例日记<small>体验用，会替换当前项目</small></button>
      <button data-act="reset" style="color:var(--danger)">清空项目</button>
    </div></div>
    <button class="btn" data-act="settings" title="模型设置">⚙ ${esc(isMock(s) ? "演示模式" : s.model || "模型设置")}</button>`;
}

function renderBanner() {
  const el = app.querySelector("#banner")!;
  if (isReadOnly()) {
    el.innerHTML = "";
    return;
  }
  const p = getProject();
  const s = loadSettings();
  const pending = pendingDates().length;
  let html = "";
  if (!p.entries.length) html = "";
  else if (!isMock(s) && !s.apiKey) html = `<span>第 1 步：<b>配置模型</b>，填写你的 API Key（默认 DeepSeek）。</span><button class="btn sm primary" data-act="settings">去设置</button><button class="btn sm" data-act="use-mock">先用演示模式体验</button>`;
  else if (!p.categoriesLocked) html = `<span>第 2 步：<b>确认分类</b>。AI 会先通读日记，提议一套大类，你确认后再逐天分析。</span><button class="btn sm primary" data-act="cats">生成分类</button>`;
  else if (pending) html = `<span>有 <b>${pending}</b> 篇日记待分析。每天的结果会先给你审阅，确认后再合并到时间轴。</span><button class="btn sm primary" data-act="analyze" ${isRunning() ? "disabled" : ""}>开始分析</button>`;
  el.innerHTML = html ? `<div class="banner">${html}</div>` : "";
}

function go(v: ViewId) {
  view = v;
  history.replaceState(null, "", "#" + v);
  renderView();
}

function renderView() {
  app.querySelectorAll<HTMLElement>("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.view === view));
  mounted?.destroy?.();
  mounted = null;
  const root = document.createElement("div");
  root.className = "view";
  root.id = "view";
  app.querySelector("#view")!.replaceWith(root);
  const p = getProject();
  if (!p.entries.length && !isReadOnly()) {
    root.innerHTML = welcomeHTML();
    return;
  }
  if (view === "timeline") {
    if (!p.categoriesLocked || !p.tasks.length && !p.daily.length) {
      root.innerHTML = `<div class="empty-state"><h2>时间轴还是空的</h2><p>已导入 ${p.entries.length} 篇日记。${p.categoriesLocked ? "开始分析后，任务会逐天出现在这里。" : "先确认分类，再开始分析。"}</p>
        <div class="row">${p.categoriesLocked ? `<button class="btn primary" data-act="analyze">开始分析</button>` : `<button class="btn primary" data-act="cats">生成分类</button>`}<button class="btn" data-view-go="entries">查看日记</button></div></div>`;
      return;
    }
    mounted = mountTimeline(root);
  } else if (view === "stats") mountStats(root);
  else if (view === "calendar") mountCalendar(root);
  else if (view === "mood") mountMood(root);
  else if (view === "weekly") mounted = mountWeekly(root);
  else mountEntries(root);
}

function welcomeHTML() {
  return `<div class="empty-state">
    <h2>把日记变成一条看得见的时间轴</h2>
    <p>导入你的打卡 / 成长日记，用你自己的大模型 API（默认 DeepSeek）提取每天推进的任务、阶段、习惯和状态，生成可交互的时间轴、统计、热力日历与周报。</p>
    <div class="row"><button class="btn primary" data-act="import">导入日记</button><button class="btn" data-act="sample">加载示例体验</button></div>
    <ol class="steps">
      <li>导入日记：上传 .md / .txt（一天一个文件），或直接粘贴</li>
      <li>配置模型：填写 API Key，Key 只保存在本浏览器</li>
      <li>确认分类：AI 提议大类，你来增删改</li>
      <li>逐天分析：每天的结果先审阅，再合并</li>
    </ol>
    <p class="hint" style="margin-top:20px">所有数据保存在浏览器本地（IndexedDB）。日记只会发送给你配置的模型服务商。</p>
  </div>`;
}

/* ───── 全局动作 ───── */

async function act(a: string) {
  const p = getProject();
  switch (a) {
    case "import":
      return openImport();
    case "analyze":
      return runAnalysis(pendingDates());
    case "cats":
      return openCategories();
    case "settings":
      return openSettings(refreshAll);
    case "use-mock": {
      const { saveSettings, presetFields } = await import("./llm");
      saveSettings({ ...loadSettings(), ...presetFields("mock") });
      toast("已切换到演示模式：结果由关键词规则生成，仅供体验界面");
      return refreshAll();
    }
    case "more":
      return app.querySelector("#more")!.classList.toggle("open");
    case "export-json":
      return download(`${p.name}-${toDateStr(new Date())}.diarylens.json`, JSON.stringify(p, null, 1));
    case "export-html":
      return exportHTML();
    case "import-json":
      return importJSON();
    case "sample":
      if (p.entries.length && !(await confirmDialog("加载示例", "加载示例会替换当前项目。建议先「导出项目 JSON」备份。", "替换", true))) return;
      return loadSamples();
    case "reset":
      if (await confirmDialog("清空项目", "删除全部日记、分类和分析结果？此操作不可撤销（除非你有导出的备份）。", "清空", true)) {
        closePanel();
        replaceProject(emptyProject());
      }
  }
}

document.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const a = t.closest<HTMLElement>("[data-act]");
  // 弹窗内的 data-act 由弹窗自己处理
  if (a && !a.closest(".modal-mask")) {
    if (a.dataset.act !== "more") app.querySelector("#more")?.classList.remove("open");
    act(a.dataset.act!);
  } else if (!t.closest("#more")) app.querySelector("#more")?.classList.remove("open");
  const g = t.closest<HTMLElement>("[data-view-go]")?.dataset.viewGo as ViewId | undefined;
  if (g) go(g);
});

function exportHTML() {
  if (import.meta.env.DEV) return toast("开发模式下无法导出离线 HTML，请使用 npm run build 后的页面", true, 5000);
  const json = JSON.stringify(getProject()).replace(/</g, "\\u003c");
  const inject = `<script>window.__DIARYLENS_EMBED__=${json};</script>`;
  const html = PRISTINE_HTML.replace(/<script/i, inject + "<script");
  download(`${getProject().name}-${toDateStr(new Date())}.html`, html, "text/html");
}

function importJSON() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.onchange = async () => {
    const f = input.files?.[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (getProject().entries.length && !(await confirmDialog("导入项目", `用「${esc(data.name ?? f.name)}」替换当前项目？`, "替换", true))) return;
      closePanel();
      replaceProject(data as Project);
      toast("项目已导入");
    } catch (e) {
      toast("导入失败：" + (e as Error).message, true);
    }
  };
  input.click();
}

async function loadSamples() {
  const files = import.meta.glob("./samples/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
  closePanel();
  replaceProject({ ...emptyProject(), name: "示例日记" });
  upsertEntries(Object.entries(files).map(([path, text]) => parseDiary(text, path.split("/").pop()!).entry));
  if (!loadSettings().apiKey && !isMock(loadSettings())) {
    const { saveSettings, presetFields } = await import("./llm");
    saveSettings({ ...loadSettings(), ...presetFields("mock") });
    toast("已加载示例并切换到演示模式；填写 API Key 后可用真实模型分析");
  } else toast("已加载示例日记");
  go("entries");
}

/* ───── 启动 ───── */

function refreshAll() {
  renderActions();
  renderBanner();
  const pname = app.querySelector<HTMLInputElement>("#pname");
  if (pname && document.activeElement !== pname) pname.value = getProject().name;
  // 时间轴保留缩放与滚动位置，其它视图直接重绘
  const p = getProject();
  const timelineReady = p.entries.length && p.categoriesLocked && (p.tasks.length || p.daily.length);
  if (view === "timeline" && mounted?.refresh && timelineReady) mounted.refresh();
  else renderView();
  refreshPanel();
}

async function start() {
  const embedded = (window as any).__DIARYLENS_EMBED__ as Project | undefined;
  await loadProject(embedded);
  shell();
  initPanel();
  onSelect(() => mounted?.rerender?.());
  renderActions();
  renderBanner();
  renderView();
  window.addEventListener("hashchange", () => {
    const v = VIEWS.find((x) => "#" + x.id === location.hash)?.id;
    if (v && v !== view) go(v);
  });
  let t: number | undefined;
  subscribe(() => {
    clearTimeout(t);
    t = window.setTimeout(refreshAll, 30);
  });
}

start();
