/** 时间轴：大类为行，bars 类画任务横条（自动分泳道），daily 类每天一格 */
import { catOf, entryOf, getProject, taskOf } from "../store";
import type { Category, DailyCell, DateStr, Task } from "../types";
import { addDays, diffDays, esc, fromDateStr, hex2rgba, isWeekend, md, segRange, taskActiveDates, taskRange, weekdayName } from "../util";
import { hideTip, showTip } from "../ui/modal";
import { getSelection, MOOD_COLORS, MOOD_NAMES, openPanel } from "./detail";

const LABEL_W = 112, LANE_H = 46, DAILY_H = 48, PAD_TOP = 8, MAXPPD = 360;

interface TaskView {
  t: Task;
  start: DateStr;
  end: DateStr;
  active: DateStr[];
  segs: { i: number; name: string; start: DateStr; end: DateStr }[];
  lane: number;
  capDays: number;
}

// 跨渲染保留的视图状态
const hidden = new Set<string>();
let ppd = 30;
let minPpd = 18;
let firstMount = true;

export function mountTimeline(root: HTMLElement) {
  root.innerHTML = `<div class="tl-tools">
      <button class="btn sm" data-z="out" title="缩小 (-)">−</button>
      <input type="range" min="0" max="1000" value="0" aria-label="缩放">
      <button class="btn sm" data-z="in" title="放大 (+)">＋</button>
      <button class="btn sm" data-z="fit" title="适应窗口 (0)">全部</button>
      <span class="muted" style="font-size:11px">Ctrl+滚轮缩放 · 拖拽平移 · 点击查看原文</span>
      <div class="legend"></div>
    </div>
    <div class="tl-scroller"><div class="tl-content"></div></div>`;
  root.style.display = "flex";
  root.style.flexDirection = "column";
  const scroller = root.querySelector<HTMLElement>(".tl-scroller")!;
  const content = root.querySelector<HTMLElement>(".tl-content")!;
  const legend = root.querySelector<HTMLElement>(".legend")!;
  const rangeEl = root.querySelector<HTMLInputElement>("input[type=range]")!;

  let first: DateStr = "", NDAYS = 1;
  let tasks: TaskView[] = [];
  let lanesByCat: Record<string, number> = {};
  let dailyBy: Record<string, DailyCell[]> = {};
  const idx = (d: DateStr) => diffDays(first, d);

  function prepare() {
    const p = getProject();
    first = p.entries[0]?.date ?? "";
    NDAYS = first ? diffDays(first, p.entries.at(-1)!.date) + 1 : 1;
    tasks = [];
    for (const t of p.tasks) {
      const r = taskRange(t);
      if (!r) continue;
      const segs = t.segments
        .map((s, i) => ({ i, name: s.name, r: segRange(s) }))
        .filter((s) => s.r)
        .map((s) => ({ i: s.i, name: s.name, start: s.r![0], end: s.r![1] }))
        .sort((a, b) => a.start.localeCompare(b.start));
      tasks.push({ t, start: r[0], end: r[1], active: taskActiveDates(t), segs, lane: 0, capDays: 0 });
    }
    lanesByCat = {};
    for (const c of p.categories) {
      if (c.mode !== "bars") continue;
      const list = tasks
        .filter((v) => v.t.cat === c.id)
        .sort((a, b) => a.start.localeCompare(b.start) || diffDays(b.start, b.end) - diffDays(a.start, a.end));
      const laneEnd: DateStr[] = [];
      for (const v of list) {
        let l = laneEnd.findIndex((e) => e < v.start);
        if (l < 0) {
          l = laneEnd.length;
          laneEnd.push("");
        }
        laneEnd[l] = v.end;
        v.lane = l;
      }
      // 标题可向右延伸到同泳道下一个任务之前
      for (const v of list) {
        const next = list.filter((o) => o.lane === v.lane && o.start > v.end).reduce((m, o) => Math.min(m, idx(o.start)), NDAYS);
        v.capDays = next - idx(v.start);
      }
      lanesByCat[c.id] = Math.max(1, laneEnd.length);
    }
    dailyBy = {};
    for (const d of p.daily) (dailyBy[d.cat] ??= []).push(d);
  }

  function renderLegend() {
    legend.innerHTML = getProject()
      .categories.map((c) => `<span class="chip ${hidden.has(c.id) ? "off" : ""}" data-cat="${c.id}"><i style="background:${c.color}"></i>${esc(c.name)}</span>`)
      .join("");
  }

  function render() {
    const p = getProject();
    const sel = getSelection();
    const W = NDAYS * ppd;
    const fullW = LABEL_W + W;
    let html = `<div class="axis" style="width:${fullW}px"><div class="corner">${ppd >= 56 ? "日期" : ""}</div><div class="days" style="width:${W}px">`;
    const step = ppd >= 26 ? 1 : ppd >= 14 ? 2 : 7;
    // 月份标签：与下一个标签挨得太近时（例如起点在月底）省略前一个
    const months: { x: number; text: string }[] = [];
    for (let i = 0, lastMonth = -1; i < NDAYS; i++) {
      const t = fromDateStr(addDays(first, i));
      if (t.getMonth() !== lastMonth) months.push({ x: i * ppd, text: `${t.getFullYear()}年${t.getMonth() + 1}月` });
      lastMonth = t.getMonth();
    }
    months.forEach((m, k) => {
      if (k + 1 < months.length && months[k + 1].x - m.x < 72) return;
      html += `<span class="monthlabel" style="left:${m.x}px">${m.text}</span>`;
    });
    for (let i = 0; i < NDAYS; i++) {
      const d = addDays(first, i), x = i * ppd, t = fromDateStr(d), e = entryOf(d);
      let inner = "";
      if (ppd >= 70) inner = `<b>${e?.label ? esc(e.label) : md(d)}</b><small>${e?.label ? md(d) + " " : ""}${weekdayName(d)}${e?.url ? " ↗" : ""}</small>`;
      else if (ppd >= 40) inner = `<b>${md(d)}</b><small>${weekdayName(d).slice(1)}</small>`;
      else if (i % step === 0) inner = `<b>${t.getDate()}</b>`;
      html += `<div class="day ${e ? "" : "none"} ${sel?.type === "day" && sel.date === d ? "sel" : ""}" data-day="${d}" style="left:${x}px;width:${ppd}px">${inner}</div>`;
    }
    html += `</div></div>`;

    for (const c of p.categories) {
      if (hidden.has(c.id)) continue;
      if (c.mode === "bars") {
        const list = tasks.filter((v) => v.t.cat === c.id);
        const h = PAD_TOP + lanesByCat[c.id] * LANE_H;
        html += `<div class="tl-row" style="width:${fullW}px;height:${h}px"><div class="rlabel" data-cat="${c.id}"><span class="nm"><i style="background:${c.color}"></i>${esc(c.name)}</span><span class="ct">${list.length} 个任务</span></div><div class="track" style="width:${W}px">`;
        for (const v of list) html += taskHTML(v, c);
        html += `</div></div>`;
      } else {
        const arr = dailyBy[c.id] ?? [];
        html += `<div class="tl-row" style="width:${fullW}px;height:${DAILY_H}px"><div class="rlabel" data-cat="${c.id}" style="padding-top:6px"><span class="nm"><i style="background:${c.color}"></i>${esc(c.name)}</span><span class="ct">${arr.length} 天有记录</span></div><div class="track" style="width:${W}px">`;
        for (const e of arr) html += cellHTML(e, c);
        html += `</div></div>`;
      }
    }
    // 状态行
    const moods = Object.entries(p.days).filter(([d, m]) => m.mood && entryOf(d));
    if (moods.length) {
      html += `<div class="tl-row" style="width:${fullW}px;height:36px"><div class="rlabel" style="padding-top:6px;cursor:default"><span class="nm"><i style="background:var(--ink-3)"></i>状态</span></div><div class="track" style="width:${W}px">`;
      for (const [d, m] of moods) {
        const x = idx(d) * ppd;
        const sz = Math.min(18, ppd - 6);
        html += `<div class="mood-dot" data-day="${d}" style="position:absolute;cursor:pointer;left:${x + (ppd - sz) / 2}px;top:${18 - sz / 2}px;width:${sz}px;height:${sz}px;border-radius:50%;background:${MOOD_COLORS[m.mood!]};color:#fff;font-size:10px;text-align:center;line-height:${sz}px">${sz >= 14 ? m.mood : ""}</div>`;
      }
      html += `</div></div>`;
    }
    content.style.width = fullW + "px";
    content.innerHTML = `<div class="tl-grid" style="width:${W}px">${gridHTML()}</div>` + html;
  }

  function gridHTML() {
    let h = "";
    let lastMonth = -1;
    for (let i = 0; i < NDAYS; i++) {
      const d = addDays(first, i), x = i * ppd, m = fromDateStr(d).getMonth();
      if (!entryOf(d)) h += `<div class="nodiary" style="left:${x}px;width:${ppd}px"></div>`;
      else if (isWeekend(d)) h += `<div class="wk" style="left:${x}px;width:${ppd}px"></div>`;
      if (lastMonth >= 0 && m !== lastMonth) h += `<div class="month" style="left:${x}px"></div>`;
      else if (ppd >= 40) h += `<div class="vl" style="left:${x}px"></div>`;
      lastMonth = m;
    }
    return h;
  }

  function taskHTML(v: TaskView, c: Category) {
    const sel = getSelection();
    const x = idx(v.start) * ppd + 2, w = (diffDays(v.start, v.end) + 1) * ppd - 4;
    const y = PAD_TOP + v.lane * LANE_H;
    const multi = v.segs.length > 1;
    const segFits = (s: TaskView["segs"][0]) => (diffDays(s.start, s.end) + 1) * ppd - 14 >= s.name.length * 11.5;
    const showSeg = multi && v.segs.every(segFits);
    const isSel = sel?.type === "task" && sel.id === v.t.id;
    let segs = "";
    v.segs.forEach((s, k) => {
      const sx = diffDays(v.start, s.start) * ppd, sw = (diffDays(s.start, s.end) + 1) * ppd;
      const label = multi ? (segFits(s) && ppd >= 40 ? esc(s.name) : "") : s.name !== v.t.name && segFits(s) ? esc(s.name) : "";
      const selSeg = isSel && sel.seg === s.i;
      segs += `<div class="seg ${k === 0 ? "first" : ""} ${selSeg ? "sel" : ""}" data-seg="${s.i}" style="left:${sx}px;width:${sw}px;background:${c.color}">${label}</div>`;
    });
    const dots = ppd >= 20 ? v.active.map((d) => `<span class="dot" style="left:${(diffDays(v.start, d) + 0.5) * ppd}px"></span>`).join("") : "";
    const cap = esc(v.t.name) + (multi && !(showSeg && ppd >= 40) ? `<em>▸ ${v.segs.length} 段</em>` : "");
    return `<div class="task ${isSel ? "active" : ""}" data-task="${v.t.id}" style="left:${x}px;top:${y}px;width:${w}px">
      <div class="cap" style="color:${c.color};max-width:${Math.max(w, v.capDays * ppd - 10)}px">${cap}</div>
      <div class="bar" style="background:${hex2rgba(c.color, 0.22)}">${segs}${dots}</div></div>`;
  }

  function cellHTML(e: DailyCell, c: Category) {
    const sel = getSelection();
    const x = idx(e.date) * ppd + 2, w = ppd - 4;
    const ti = Math.max(0, c.tags?.findIndex((t) => t.id === e.tag) ?? 0);
    const tagName = c.tags?.[ti]?.name ?? "";
    const rest = /休息|无|rest|none|skip/i.test(tagName + e.tag);
    const alpha = [1, 0.68, 0.45, 0.3][Math.min(ti, 3)];
    const isSel = sel?.type === "cell" && sel.cat === c.id && sel.date === e.date;
    return `<div class="cell ${rest ? "rest" : ""} ${alpha < 0.5 ? "light" : ""} ${isSel ? "sel" : ""}" data-cell="${c.id}|${e.date}" style="left:${x}px;width:${w}px;background:${hex2rgba(c.color, alpha)};border-color:${c.color}">${ppd >= 70 ? esc(e.label) : ""}</div>`;
  }

  /* ───── 缩放 ───── */
  const toSlider = (v: number) => Math.round((1000 * Math.log(v / minPpd)) / Math.log(MAXPPD / minPpd));
  const fromSlider = (v: number) => minPpd * Math.pow(MAXPPD / minPpd, v / 1000);
  const computeMin = () => (minPpd = Math.max(8, (scroller.clientWidth - LABEL_W - 4) / NDAYS));
  function setZoom(v: number, anchorX?: number) {
    v = Math.max(minPpd, Math.min(MAXPPD, v));
    if (anchorX == null) anchorX = (scroller.clientWidth - LABEL_W) / 2;
    const dayAt = (scroller.scrollLeft + anchorX) / ppd;
    ppd = v;
    render();
    scroller.scrollLeft = dayAt * ppd - anchorX;
    rangeEl.value = String(toSlider(ppd));
  }
  root.querySelector(".tl-tools")!.addEventListener("click", (e) => {
    const z = (e.target as HTMLElement).closest<HTMLElement>("[data-z]")?.dataset.z;
    if (z === "in") setZoom(ppd * 1.4);
    else if (z === "out") setZoom(ppd / 1.4);
    else if (z === "fit") {
      computeMin();
      setZoom(minPpd);
      scroller.scrollLeft = 0;
    }
    const chip = (e.target as HTMLElement).closest<HTMLElement>(".chip");
    if (chip) {
      const id = chip.dataset.cat!;
      hidden.has(id) ? hidden.delete(id) : hidden.add(id);
      renderLegend();
      render();
    }
  });
  rangeEl.oninput = () => setZoom(fromSlider(+rangeEl.value));
  scroller.addEventListener(
    "wheel",
    (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const rect = scroller.getBoundingClientRect();
      setZoom(ppd * Math.exp(-e.deltaY * 0.0022), Math.max(0, e.clientX - rect.left - LABEL_W));
    },
    { passive: false },
  );
  const onKey = (e: KeyboardEvent) => {
    if (!root.isConnected || /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName) || document.querySelector(".modal-mask")) return;
    if (e.key === "+" || e.key === "=") setZoom(ppd * 1.4);
    else if (e.key === "-") setZoom(ppd / 1.4);
    else if (e.key === "0") (root.querySelector("[data-z=fit]") as HTMLElement).click();
  };
  document.addEventListener("keydown", onKey);
  const onResize = () => {
    const old = minPpd;
    computeMin();
    if (ppd <= old + 0.01) setZoom(minPpd);
    else rangeEl.value = String(toSlider(ppd));
  };
  window.addEventListener("resize", onResize);

  /* ───── 拖拽平移 ───── */
  let drag: { x: number; y: number; sl: number; st: number; moved: boolean } | null = null;
  scroller.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest(".task,.cell,.day,.rlabel,.mood-dot")) return;
    drag = { x: e.clientX, y: e.clientY, sl: scroller.scrollLeft, st: scroller.scrollTop, moved: false };
    scroller.classList.add("dragging");
  });
  const onMove = (e: MouseEvent) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    scroller.scrollLeft = drag.sl - dx;
    scroller.scrollTop = drag.st - dy;
  };
  const onUp = () => {
    drag = null;
    scroller.classList.remove("dragging");
  };
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);

  /* ───── 悬浮与点击 ───── */
  const rangeText = (a: DateStr, b: DateStr) => (a === b ? `${md(a)} ${weekdayName(a)}` : `${md(a)} – ${md(b)}`);
  content.addEventListener("mousemove", (e) => {
    if (drag?.moved) return;
    const t = e.target as HTMLElement;
    const seg = t.closest<HTMLElement>(".seg"), task = t.closest<HTMLElement>(".task"), cell = t.closest<HTMLElement>(".cell");
    const day = t.closest<HTMLElement>(".day,.mood-dot");
    if (task) {
      const v = tasks.find((x) => x.t.id === task.dataset.task)!;
      let h = `<div class="t">${esc(v.t.name)}</div><div class="s">${rangeText(v.start, v.end)} · 活跃 ${v.active.length} 天</div>`;
      if (seg && v.segs.length > 1) {
        const s = v.segs.find((x) => x.i === +seg.dataset.seg!)!;
        h += `<div style="margin-top:4px">▸ ${esc(s.name)}</div><div class="s">${rangeText(s.start, s.end)}</div>`;
      }
      showTip(h, e);
    } else if (cell) {
      const [cid, d] = cell.dataset.cell!.split("|");
      const it = dailyBy[cid].find((x) => x.date === d)!;
      const c = catOf(cid)!;
      showTip(`<div class="t">${esc(it.label)}</div><div class="s">${md(d)} ${weekdayName(d)} · ${esc(c.tags?.find((x) => x.id === it.tag)?.name ?? "")}</div>`, e);
    } else if (day) {
      const d = day.dataset.day!, en = entryOf(d), m = getProject().days[d];
      showTip(
        en
          ? `<div class="t">${d} ${weekdayName(d)}${en.label ? " · " + esc(en.label) : ""}</div>${m?.mood ? `<div>状态 ${m.mood} ${MOOD_NAMES[m.mood]}${m.moodNote ? "：" + esc(m.moodNote) : ""}</div>` : ""}${m?.summary ? `<div class="s">${esc(m.summary)}</div>` : `<div class="s">点击查看当天内容</div>`}`
          : `<div class="t">${d}</div><div class="s">这天没有日记</div>`,
        e,
      );
    } else hideTip();
  });
  content.addEventListener("mouseleave", hideTip);
  content.addEventListener("click", (e) => {
    if (drag?.moved) return;
    const t = e.target as HTMLElement;
    const seg = t.closest<HTMLElement>(".seg"), task = t.closest<HTMLElement>(".task"), cell = t.closest<HTMLElement>(".cell");
    const day = t.closest<HTMLElement>(".day,.mood-dot"), lab = t.closest<HTMLElement>(".rlabel[data-cat]");
    if (task) {
      const tk = taskOf(task.dataset.task!)!;
      openPanel({ type: "task", id: tk.id, seg: seg && tk.segments.length > 1 ? +seg.dataset.seg! : null });
    } else if (cell) {
      const [cid, d] = cell.dataset.cell!.split("|");
      openPanel({ type: "cell", cat: cid, date: d });
    } else if (day && entryOf(day.dataset.day!)) openPanel({ type: "day", date: day.dataset.day! });
    else if (lab) openPanel({ type: "cat", id: lab.dataset.cat! });
  });

  function refresh() {
    prepare();
    renderLegend();
    const old = minPpd;
    computeMin();
    if (ppd < minPpd || ppd <= old + 0.01) ppd = Math.max(minPpd, Math.min(ppd, 30));
    render();
    rangeEl.value = String(toSlider(ppd));
  }

  refresh();
  if (firstMount) {
    // 首次打开滚到最新
    scroller.scrollLeft = scroller.scrollWidth;
    firstMount = false;
  }

  return {
    refresh,
    rerender: render,
    destroy() {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      hideTip();
    },
  };
}
