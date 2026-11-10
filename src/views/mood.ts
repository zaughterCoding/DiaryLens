/** 状态曲线：AI 评估的每日状态（1–5）+ 依据 */
import { getProject } from "../store";
import type { DateStr } from "../types";
import { addDays, diffDays, esc, md, weekdayName } from "../util";
import { hideTip, showTip } from "../ui/modal";
import { MOOD_COLORS, MOOD_NAMES, moodPill, openPanel } from "./detail";

export function mountMood(root: HTMLElement) {
  const p = getProject();
  const pts = p.entries.filter((e) => p.days[e.date]?.mood).map((e) => ({ d: e.date, m: p.days[e.date].mood!, meta: p.days[e.date] }));
  if (!pts.length) {
    root.innerHTML = `<div class="empty-state"><h2>还没有状态数据</h2><p>分析日记时，AI 会顺带给每天的情绪/状态打 1–5 分，这里画成曲线。</p></div>`;
    return;
  }
  const first = pts[0].d, last = pts.at(-1)!.d;
  const n = diffDays(first, last) + 1;
  const counts = [0, 0, 0, 0, 0, 0];
  pts.forEach((x) => counts[x.m]++);
  const avg = pts.reduce((s, x) => s + x.m, 0) / pts.length;

  // 7 日滑动平均，用于看趋势
  const byDate = new Map(pts.map((x) => [x.d, x.m]));

  root.innerHTML = `<div class="page">
    <h2>状态曲线</h2><div class="sub">由 AI 根据日记语气和内容评估，仅供回顾参考。共 ${pts.length} 天，平均 ${avg.toFixed(1)}。</div>
    <div class="card"><div id="mood-chart" style="overflow-x:auto"></div>
      <div class="cal-legend" style="gap:10px">${[1, 2, 3, 4, 5].map((m) => `<span><i style="background:${MOOD_COLORS[m]};border-radius:50%;vertical-align:-2px"></i> ${m} ${MOOD_NAMES[m]}（${counts[m]}）</span>`).join("")}
        <span><i style="background:var(--ink-2);height:2px;width:16px;vertical-align:3px"></i> 7 日平均</span></div>
    </div>
    <div class="card"><h3>低谷与高光</h3><div class="grid2">
      <div>${listDays([...pts].sort((a, b) => a.m - b.m || a.d.localeCompare(b.d)).slice(0, 5))}</div>
      <div>${listDays([...pts].sort((a, b) => b.m - a.m || a.d.localeCompare(b.d)).slice(0, 5))}</div>
    </div></div>
    <details class="card"><summary style="cursor:pointer;font-weight:600">全部记录（表格）</summary>
      <table class="tbl"><thead><tr><th>日期</th><th>状态</th><th>依据</th><th>概要</th></tr></thead><tbody>
      ${pts.map((x) => `<tr data-d="${x.d}" style="cursor:pointer"><td>${x.d}</td><td>${moodPill(x.m)}</td><td>${esc(x.meta.moodNote ?? "")}</td><td>${esc(x.meta.summary ?? "")}</td></tr>`).join("")}
      </tbody></table></details>
  </div>`;

  function listDays(list: typeof pts) {
    return list
      .map((x) => `<div class="listrow" data-d="${x.d}">${moodPill(x.m)}<span>${md(x.d)} ${weekdayName(x.d)}</span>${esc(x.meta.moodNote ?? x.meta.summary ?? "")}</div>`)
      .join("");
  }

  root.querySelector(".page")!.addEventListener("click", (e) => {
    const d = (e.target as HTMLElement).closest<HTMLElement>("[data-d]")?.dataset.d;
    if (d) openPanel({ type: "day", date: d });
  });

  // 画图
  const el = root.querySelector<HTMLElement>("#mood-chart")!;
  const padL = 30, padR = 20, padT = 12, padB = 26, H = 240;
  // 预留页面竖向滚动条的宽度（测量时它可能还没出现）
  const avail = (el.clientWidth || 800) - 20;
  const W = Math.max(avail, n * 14 + padL + padR);
  const x = (d: DateStr) => padL + (n === 1 ? (W - padL - padR) / 2 : (diffDays(first, d) / (n - 1)) * (W - padL - padR));
  const y = (m: number) => padT + ((5 - m) / 4) * (H - padT - padB);
  let svg = "";
  for (let m = 1; m <= 5; m++) svg += `<line x1="${padL}" x2="${W - padR}" y1="${y(m)}" y2="${y(m)}" stroke="var(--line-2)"/><text x="${padL - 8}" y="${y(m) + 4}" text-anchor="end">${m}</text>`;
  // 日期刻度
  const tickEvery = Math.max(1, Math.ceil(n / Math.floor((W - padL) / 60)));
  for (let i = 0; i < n; i += tickEvery) {
    const d = addDays(first, i);
    svg += `<text x="${x(d)}" y="${H - 8}" text-anchor="middle">${md(d)}</text>`;
  }
  // 原始折线（缺日断开）
  let path = "", prev: DateStr | null = null;
  for (const pt of pts) {
    path += `${prev && diffDays(prev, pt.d) === 1 ? "L" : "M"}${x(pt.d).toFixed(1)},${y(pt.m).toFixed(1)}`;
    prev = pt.d;
  }
  svg += `<path d="${path}" fill="none" stroke="var(--ink-3)" stroke-width="1.5" stroke-opacity=".6"/>`;
  // 7 日平均
  let avgPath = "";
  pts.forEach((pt, i) => {
    const win: number[] = [];
    for (let k = -6; k <= 0; k++) {
      const v = byDate.get(addDays(pt.d, k));
      if (v) win.push(v);
    }
    const a = win.reduce((s, v) => s + v, 0) / win.length;
    avgPath += `${i ? "L" : "M"}${x(pt.d).toFixed(1)},${y(a).toFixed(1)}`;
  });
  svg += `<path d="${avgPath}" fill="none" stroke="var(--ink-2)" stroke-width="2"/>`;
  svg += `<line id="xh" y1="${padT}" y2="${H - padB}" stroke="var(--ink-3)" stroke-dasharray="3 3" visibility="hidden"/>`;
  for (const pt of pts) svg += `<circle cx="${x(pt.d)}" cy="${y(pt.m)}" r="5" fill="${MOOD_COLORS[pt.m]}" stroke="var(--surface)" stroke-width="2"/>`;
  el.innerHTML = `<svg style="display:block" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="每日状态曲线">${svg}<rect x="${padL}" y="0" width="${W - padL - padR}" height="${H}" fill="transparent" id="hit"/></svg>`;

  const svgEl = el.querySelector("svg")!;
  const xh = svgEl.querySelector<SVGLineElement>("#xh")!;
  const nearest = (e: MouseEvent) => {
    const r = svgEl.getBoundingClientRect();
    const mx = ((e.clientX - r.left) / r.width) * W;
    return pts.reduce((b, pt) => (Math.abs(x(pt.d) - mx) < Math.abs(x(b.d) - mx) ? pt : b), pts[0]);
  };
  svgEl.addEventListener("mousemove", (e) => {
    const pt = nearest(e);
    xh.setAttribute("x1", String(x(pt.d)));
    xh.setAttribute("x2", String(x(pt.d)));
    xh.setAttribute("visibility", "visible");
    showTip(`<div class="t">${pt.d} ${weekdayName(pt.d)} · ${pt.m} ${MOOD_NAMES[pt.m]}</div>${pt.meta.moodNote ? `<div>${esc(pt.meta.moodNote)}</div>` : ""}${pt.meta.summary ? `<div class="s">${esc(pt.meta.summary)}</div>` : ""}`, e);
  });
  svgEl.addEventListener("mouseleave", () => {
    xh.setAttribute("visibility", "hidden");
    hideTip();
  });
  svgEl.addEventListener("click", (e) => openPanel({ type: "day", date: nearest(e).d }));
}

