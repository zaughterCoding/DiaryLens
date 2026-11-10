/** 每日热力日历：每天一格，颜色深浅 = 当天推进的事项数，可按大类筛选 */
import { entryOf, getProject } from "../store";
import type { DateStr } from "../types";
import { addDays, diffDays, esc, fromDateStr, weekStart, weekdayName } from "../util";
import { hideTip, showTip } from "../ui/modal";
import { openPanel } from "./detail";
import { dayActivity } from "./metrics";

// 单色顺序色阶（浅→深）
const RAMP = ["#cde2fb", "#86b6ef", "#3987e5", "#1c5cab"];
let filter = "";

export function mountCalendar(root: HTMLElement) {
  const p = getProject();
  if (!p.entries.length) {
    root.innerHTML = `<div class="empty-state"><h2>还没有日记</h2></div>`;
    return;
  }
  const act = dayActivity();

  const valueOf = (d: DateStr): number | null => {
    if (!entryOf(d)) return null;
    if (!p.days[d]?.analyzedAt) return 0;
    if (!filter) return act.get(d)?.items ?? 0;
    const c = p.categories.find((x) => x.id === filter);
    if (c?.mode === "daily") return p.daily.some((x) => x.cat === filter && x.date === d) ? 1 : 0;
    return p.tasks.filter((t) => t.cat === filter && t.segments.some((s) => s.refs[d]?.length)).length;
  };

  const render = () => {
    const first = p.entries[0].date, last = p.entries.at(-1)!.date;
    const start = weekStart(first);
    const nWeeks = Math.floor(diffDays(start, last) / 7) + 1;
    const vals = new Map<DateStr, number | null>();
    for (let i = 0; i < nWeeks * 7; i++) {
      const d = addDays(start, i);
      if (d >= first && d <= last) vals.set(d, valueOf(d));
    }
    const nonzero = [...vals.values()].filter((v): v is number => !!v).sort((a, b) => a - b);
    // 按分位数切 4 档，避免个别高值把其他天压得太浅
    const q = (f: number) => nonzero[Math.min(nonzero.length - 1, Math.floor(f * nonzero.length))] ?? 1;
    const th = [q(0.25), q(0.5), q(0.75)];
    const level = (v: number) => (v <= th[0] ? 0 : v <= th[1] ? 1 : v <= th[2] ? 2 : 3);

    const G = 3, L = 28, T = 20;
    // 时间跨度短时放大格子，铺满可用宽度
    const avail = Math.min(1068, (root.clientWidth || 800) - 64) - L;
    const C = Math.max(13, Math.min(34, Math.floor(avail / nWeeks) - G));
    let svg = "";
    ["一", "三", "五", "日"].forEach((w) => {
      const row = { 一: 0, 三: 2, 五: 4, 日: 6 }[w]!;
      svg += `<text x="${L - 6}" y="${T + row * (C + G) + C / 2 + 4}" text-anchor="end">${w}</text>`;
    });
    let lastMonth = -1;
    for (let w = 0; w < nWeeks; w++) {
      const ws = addDays(start, w * 7);
      const m = fromDateStr(addDays(ws, 6)).getMonth();
      if (m !== lastMonth) {
        svg += `<text x="${L + w * (C + G)}" y="12">${m + 1}月</text>`;
        lastMonth = m;
      }
      for (let r = 0; r < 7; r++) {
        const d = addDays(ws, r);
        if (!vals.has(d)) continue;
        const v = vals.get(d)!;
        const x = L + w * (C + G), y = T + r * (C + G);
        const fill = v === null ? "transparent" : v === 0 ? "var(--line-2)" : RAMP[level(v)];
        const stroke = v === null ? `stroke="var(--line)" stroke-dasharray="2 2"` : "";
        svg += `<rect x="${x}" y="${y}" width="${C}" height="${C}" rx="3" fill="${fill}" ${stroke} data-d="${d}" style="cursor:${v === null ? "default" : "pointer"}"/>`;
        if (C >= 24) svg += `<text x="${x + C / 2}" y="${y + C / 2 + 4}" text-anchor="middle" style="pointer-events:none;font-size:10px;fill:${v !== null && v > 0 && level(v) >= 2 ? "#fff" : "var(--ink-2)"}">${fromDateStr(d).getDate()}</text>`;
      }
    }
    const W = L + nWeeks * (C + G), H = T + 7 * (C + G);

    // 连续天数
    let best = 0, cur = 0, bestEnd = "";
    for (const [d, v] of vals) {
      if (v && v > 0) {
        cur++;
        if (cur > best) (best = cur), (bestEnd = d);
      } else cur = 0;
    }
    const activeDays = [...vals.values()].filter((v) => v && v > 0).length;

    root.innerHTML = `<div class="page">
      <h2>热力日历</h2><div class="sub">每天一格，颜色越深表示当天推进的任务和每日事项越多。虚线格 = 没有日记。</div>
      <div class="card">
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
          <select id="cal-filter"><option value="">全部大类</option>${p.categories.map((c) => `<option value="${c.id}" ${c.id === filter ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>
          <span class="hint">有记录 ${activeDays} 天 · 最长连续 ${best} 天${best ? `（截至 ${bestEnd}）` : ""}</span>
        </div>
        <div class="cal-wrap"><svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="每日活动热力图">${svg}</svg></div>
        <div class="cal-legend">少 <i style="background:var(--line-2)"></i>${RAMP.map((c) => `<i style="background:${c}"></i>`).join("")} 多</div>
      </div>
    </div>`;
    const svgEl = root.querySelector("svg")!;
    svgEl.addEventListener("mousemove", (e) => {
      const d = ((e.target as Element).closest("[data-d]") as SVGElement | null)?.dataset.d;
      if (!d) return hideTip();
      const v = vals.get(d);
      const m = p.days[d];
      const fname = filter ? p.categories.find((c) => c.id === filter)?.name : "";
      showTip(
        v === null
          ? `<div class="t">${d} ${weekdayName(d)}</div><div class="s">没有日记</div>`
          : `<div class="t">${d} ${weekdayName(d)}</div><div>${m?.analyzedAt ? `${fname ? esc(fname) + "：" : ""}${v} 项` : "尚未分析"}</div>${m?.summary ? `<div class="s">${esc(m.summary)}</div>` : ""}`,
        e,
      );
    });
    svgEl.addEventListener("mouseleave", hideTip);
    svgEl.addEventListener("click", (e) => {
      const d = ((e.target as Element).closest("[data-d]") as SVGElement | null)?.dataset.d;
      if (d && entryOf(d)) openPanel({ type: "day", date: d });
    });
    root.querySelector<HTMLSelectElement>("#cal-filter")!.onchange = (e) => {
      filter = (e.target as HTMLSelectElement).value;
      render();
    };
  };
  render();
}
