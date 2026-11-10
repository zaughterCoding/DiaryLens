/** 右侧详情侧栏：任务 / 每日格 / 某一天 / 大类 */
import { catOf, entryOf, getProject, taskOf } from "../store";
import type { DateStr } from "../types";
import { diffDays, esc, md, refDates, segRange, taskActiveDates, taskRange, uniqSorted, weekdayName } from "../util";
import { hideTip } from "../ui/modal";

export type Selection =
  | { type: "task"; id: string; seg: number | null }
  | { type: "cell"; cat: string; date: DateStr }
  | { type: "day"; date: DateStr }
  | { type: "cat"; id: string };

let panel: HTMLElement, ph: HTMLElement, pb: HTMLElement;
let sel: Selection | null = null;
const listeners = new Set<(s: Selection | null) => void>();

export const getSelection = () => sel;
export const onSelect = (fn: (s: Selection | null) => void) => listeners.add(fn);

/** 状态是有正负的量：红—灰—蓝发散色，中点为中性灰 */
export const MOOD_COLORS = ["", "#e34948", "#ec9a98", "#9aa1ad", "#86b6ef", "#2a78d6"];
export const MOOD_NAMES = ["", "很差", "偏低", "一般", "不错", "很好"];

export function initPanel() {
  panel = document.createElement("aside");
  panel.id = "panel";
  panel.innerHTML = `<div class="ph"></div><div class="pb"></div>`;
  document.body.appendChild(panel);
  ph = panel.querySelector(".ph")!;
  pb = panel.querySelector(".pb")!;
  ph.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest(".close")) return closePanel();
    const tab = t.closest<HTMLElement>(".ptab");
    if (tab && sel?.type === "task") openPanel({ ...sel, seg: tab.dataset.seg === "" ? null : +tab.dataset.seg! });
  });
  pb.addEventListener("click", (e) => {
    const it = (e.target as HTMLElement).closest<HTMLElement>("[data-go]");
    if (!it) return;
    const [type, a, b] = it.dataset.go!.split("|");
    if (type === "task") openPanel({ type, id: a, seg: b === "" || b == null ? null : +b });
    else if (type === "cell") openPanel({ type, cat: a, date: b });
    else if (type === "day") openPanel({ type, date: a });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && panel.classList.contains("open") && !document.querySelector(".modal-mask")) closePanel();
  });
}

const notify = () => listeners.forEach((fn) => fn(sel));

export function closePanel() {
  sel = null;
  panel.classList.remove("open");
  notify();
}

export function openPanel(s: Selection) {
  sel = s;
  hideTip();
  panel.classList.add("open");
  if (s.type === "task") panelTask(s);
  else if (s.type === "cell") panelCell(s);
  else if (s.type === "day") panelDay(s);
  else panelCat(s);
  pb.scrollTop = 0;
  notify();
}

/** 数据变化后刷新当前侧栏（对象可能已被删除） */
export function refreshPanel() {
  if (!sel) return;
  const ok =
    (sel.type === "task" && taskOf(sel.id)) ||
    (sel.type === "cat" && catOf(sel.id)) ||
    (sel.type === "day" && entryOf(sel.date)) ||
    (sel.type === "cell" && getProject().daily.some((d) => d.cat === (sel as any).cat && d.date === (sel as any).date));
  ok ? openPanel(sel) : closePanel();
}

/* ───── 渲染 ───── */

const closeBtn = `<button class="close" title="关闭 (Esc)">×</button>`;
const dayName = (d: DateStr) => {
  const e = entryOf(d);
  return `${d} ${weekdayName(d)}${e?.label ? " · " + esc(e.label) : ""}`;
};
const rangeText = (a: DateStr, b: DateStr) => (a === b ? `${a} ${weekdayName(a)}` : `${a} – ${b}`);
const paraHTML = (d: DateStr, list: number[]) => {
  const e = entryOf(d);
  return list.map((i) => (e?.paras[i] != null ? `<div class="quote">${esc(e.paras[i])}</div>` : "")).join("");
};
const dayHead = (d: DateStr, extra = "") => {
  const e = entryOf(d);
  return `<div class="dh"><b data-go="day|${d}" style="cursor:pointer">${md(d)} ${weekdayName(d)}</b><span>${e?.label ? esc(e.label) : d}</span>${extra}${e?.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">原帖 ↗</a>` : ""}</div>`;
};
const catHead = (cid: string, suffix = "") => {
  const c = catOf(cid);
  return c ? `<div class="cat" style="color:${c.color}"><i style="background:${c.color}"></i>${esc(c.name)}${suffix}</div>` : "";
};

function panelTask(s: Extract<Selection, { type: "task" }>) {
  const t = taskOf(s.id)!;
  const c = catOf(t.cat)!;
  const [a, b] = taskRange(t) ?? ["", ""];
  const span = a ? diffDays(a, b) + 1 : 0;
  const segs = t.segments
    .map((x, i) => ({ x, i, r: segRange(x) }))
    .filter((v) => v.r)
    .sort((p, q) => p.r![0].localeCompare(q.r![0]));
  let tabs = "";
  if (segs.length > 1) {
    tabs =
      `<div class="ptabs"><span class="ptab ${s.seg == null ? "on" : ""}" data-seg="" style="${s.seg == null ? "background:" + c.color : ""}">全部<small>${segs.length}段</small></span>` +
      segs
        .map(
          ({ x, i, r }) =>
            `<span class="ptab ${s.seg === i ? "on" : ""}" data-seg="${i}" style="${s.seg === i ? "background:" + c.color : ""}">${esc(x.name)}<small>${r![0] === r![1] ? md(r![0]) : md(r![0]) + "–" + md(r![1])}</small></span>`,
        )
        .join("") +
      `</div>`;
  }
  ph.innerHTML =
    closeBtn +
    catHead(t.cat) +
    `<h2>${esc(t.name)}</h2><div class="rng">${rangeText(a, b)} · 跨 ${span} 天 · 活跃 ${taskActiveDates(t).length} 天</div>` +
    (t.desc ? `<div class="desc">${esc(t.desc)}</div>` : "") +
    tabs;

  const chosen = s.seg == null ? segs : segs.filter((v) => v.i === s.seg);
  const byDay = new Map<DateStr, { name: string; ps: number[] }[]>();
  for (const { x } of chosen)
    for (const d of refDates(x.refs)) {
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d)!.push({ name: x.name, ps: x.refs[d] });
    }
  pb.innerHTML =
    [...byDay.keys()]
      .sort()
      .map((d) => {
        const parts = byDay.get(d)!;
        const tag = segs.length > 1 && s.seg == null ? parts.map((p) => `<span class="stag" style="background:${c.color}">${esc(p.name)}</span>`).join("") : "";
        return `<div class="dayblock">${dayHead(d, tag)}${paraHTML(d, uniqSorted(parts.flatMap((p) => p.ps)))}</div>`;
      })
      .join("") || `<div class="muted" style="margin-top:20px">暂无引用原文</div>`;
}

function panelCell(s: Extract<Selection, { type: "cell" }>) {
  const c = catOf(s.cat)!;
  const it = getProject().daily.find((d) => d.cat === s.cat && d.date === s.date)!;
  ph.innerHTML = closeBtn + catHead(s.cat, " · " + esc(c.tags?.find((t) => t.id === it.tag)?.name ?? "")) + `<h2>${esc(it.label)}</h2><div class="rng">${dayName(s.date)}</div>`;
  pb.innerHTML = `<div class="dayblock">${dayHead(s.date)}${paraHTML(s.date, it.paras)}</div>`;
}

export function moodPill(m?: number) {
  // 中间三档底色较浅，用深色字保证对比度
  return m ? `<span class="mood-pill" style="background:${MOOD_COLORS[m]};color:${m === 1 || m === 5 ? "#fff" : "#1f2430"}">${m} ${MOOD_NAMES[m]}</span>` : "";
}

function panelDay(s: Extract<Selection, { type: "day" }>) {
  const p = getProject();
  const d = s.date;
  const e = entryOf(d)!;
  const meta = p.days[d];
  ph.innerHTML =
    closeBtn +
    `<div class="cat" style="color:var(--ink-2)">当天概览</div><h2>${md(d)} ${weekdayName(d)}${e.label ? " · " + esc(e.label) : ""}</h2>` +
    `<div class="rng">${d}${e.url ? ` · <a href="${esc(e.url)}" target="_blank" rel="noopener">原帖 ↗</a>` : ""}${meta?.analyzedAt ? "" : " · 尚未分析"}</div>` +
    (meta?.summary || meta?.mood ? `<div class="daymeta">${moodPill(meta.mood)} ${esc(meta.moodNote ?? "")}${meta.summary ? `<div style="margin-top:4px">${esc(meta.summary)}</div>` : ""}</div>` : "");
  const used = new Set<number>();
  let h = "";
  for (const c of p.categories) {
    if (c.mode === "bars") {
      for (const t of p.tasks.filter((t) => t.cat === c.id))
        t.segments.forEach((sg, i) => {
          const ps = sg.refs[d];
          if (!ps?.length) return;
          ps.forEach((x) => used.add(x));
          const name = t.segments.length > 1 ? `${esc(t.name)}<span>· ${esc(sg.name)}</span>` : esc(t.name);
          h += `<div class="item"><div class="ih" data-go="task|${t.id}|${t.segments.length > 1 ? i : ""}"><i style="background:${c.color}"></i>${name}</div>${paraHTML(d, ps)}</div>`;
        });
    } else {
      const it = p.daily.find((x) => x.cat === c.id && x.date === d);
      if (!it) continue;
      it.paras.forEach((x) => used.add(x));
      h += `<div class="item"><div class="ih" data-go="cell|${c.id}|${d}"><i style="background:${c.color}"></i>${esc(c.name)}<span>· ${esc(it.label)}</span></div>${paraHTML(d, it.paras)}</div>`;
    }
  }
  const rest = e.paras.map((_, i) => i).filter((i) => !used.has(i));
  if (rest.length)
    h += meta?.analyzedAt
      ? `<details class="rest"><summary>未归入任务的段落（${rest.length}）</summary>${paraHTML(d, rest)}</details>`
      : `<div class="dayblock">${paraHTML(d, rest)}</div>`;
  pb.innerHTML = h || `<div class="muted" style="margin-top:20px">当天没有内容</div>`;
}

function panelCat(s: Extract<Selection, { type: "cat" }>) {
  const p = getProject();
  const c = catOf(s.id)!;
  ph.innerHTML = closeBtn + catHead(c.id, " · 大类") + `<h2>${esc(c.name)}</h2>` + (c.desc ? `<div class="desc">${esc(c.desc)}</div>` : "");
  if (c.mode === "bars") {
    const list = p.tasks
      .filter((t) => t.cat === c.id && taskRange(t))
      .sort((a, b) => taskRange(a)![0].localeCompare(taskRange(b)![0]));
    ph.innerHTML += `<div class="rng" style="margin-top:6px">${list.length} 个任务</div>`;
    pb.innerHTML = list
      .map((t) => {
        const [a, b] = taskRange(t)!;
        return `<div class="listrow" data-go="task|${t.id}|"><span>${a === b ? md(a) : md(a) + "–" + md(b)}</span>${esc(t.name)}${t.segments.length > 1 ? `<span>${t.segments.length}段</span>` : ""}</div>`;
      })
      .join("");
  } else {
    const arr = p.daily.filter((d) => d.cat === c.id).sort((a, b) => a.date.localeCompare(b.date));
    const counts: Record<string, number> = {};
    arr.forEach((e) => (counts[e.tag] = (counts[e.tag] || 0) + 1));
    ph.innerHTML += `<div class="rng" style="margin-top:6px">${arr.length} 天有记录 · ${Object.entries(counts)
      .map(([k, v]) => `${esc(c.tags?.find((t) => t.id === k)?.name ?? k)} ${v}`)
      .join(" · ")}</div>`;
    pb.innerHTML = arr
      .map((e) => `<div class="listrow" data-go="cell|${c.id}|${e.date}"><span>${md(e.date)} ${weekdayName(e.date)}</span>${esc(e.label)}<span>${esc(c.tags?.find((t) => t.id === e.tag)?.name ?? "")}</span></div>`)
      .join("");
  }
}
