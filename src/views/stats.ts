/** 统计：概览数字、各大类投入、按周变化、投入最多的任务 */
import { getProject } from "../store";
import type { DateStr } from "../types";
import { addDays, esc, md, taskActiveDates, taskRange, weekStart } from "../util";
import { hideTip, showTip } from "../ui/modal";
import { openPanel } from "./detail";
import { dayActivity } from "./metrics";

export function mountStats(root: HTMLElement) {
  const p = getProject();
  const act = dayActivity();
  const analyzed = p.entries.filter((e) => p.days[e.date]?.analyzedAt);
  if (!analyzed.length) {
    root.innerHTML = `<div class="empty-state"><h2>还没有分析结果</h2><p>分析过日记之后，这里会显示各大类的投入统计。</p></div>`;
    return;
  }
  const nDays = analyzed.length;

  // 每个大类的活跃天数
  const catDays = new Map<string, number>();
  for (const [, a] of act) for (const c of a.cats) catDays.set(c, (catDays.get(c) ?? 0) + 1);
  const cats = p.categories.filter((c) => catDays.get(c.id)).sort((a, b) => catDays.get(b.id)! - catDays.get(a.id)!);
  const maxDays = Math.max(1, ...cats.map((c) => catDays.get(c.id)!));

  const moods = analyzed.map((e) => p.days[e.date].mood).filter((m): m is number => !!m);
  const avgMood = moods.length ? (moods.reduce((a, b) => a + b, 0) / moods.length).toFixed(1) : "–";
  const activeTasks = p.tasks.filter((t) => taskRange(t));

  const topTasks = activeTasks
    .map((t) => ({ t, n: taskActiveDates(t).length, r: taskRange(t)! }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 10);

  root.innerHTML = `<div class="page">
    <h2>统计</h2><div class="sub">基于已分析的 ${nDays} 篇日记（${analyzed[0].date} – ${analyzed.at(-1)!.date}）</div>
    <div class="kpis">
      <div class="kpi"><div class="v">${nDays}</div><div class="l">已分析天数${p.entries.length > nDays ? ` / 共 ${p.entries.length}` : ""}</div></div>
      <div class="kpi"><div class="v">${activeTasks.length}</div><div class="l">任务数</div></div>
      <div class="kpi"><div class="v">${activeTasks.reduce((s, t) => s + t.segments.length, 0)}</div><div class="l">阶段数</div></div>
      <div class="kpi"><div class="v">${avgMood}</div><div class="l">平均状态（1–5）</div></div>
    </div>
    <div class="grid2">
      <div class="card"><h3>各大类投入天数</h3>
        ${cats
          .map((c) => {
            const n = catDays.get(c.id)!;
            return `<div class="hbar" data-cat="${c.id}" style="cursor:pointer"><span>${esc(c.name)}</span><div class="track2"><i style="width:${(n / maxDays) * 100}%;background:${c.color}"></i></div><span class="n">${n} 天 · ${Math.round((n / nDays) * 100)}%</span></div>`;
          })
          .join("")}
        <div class="hint" style="margin-top:8px">百分比 = 该大类有记录的天数 / 已分析天数。</div>
      </div>
      <div class="card toplist"><h3>投入最多的任务</h3>
        ${topTasks
          .map(({ t, n, r }) => {
            const c = p.categories.find((x) => x.id === t.cat);
            return `<div class="listrow" data-task="${t.id}" style="cursor:pointer"><i style="width:8px;height:8px;border-radius:2px;background:${c?.color};flex:none;align-self:center"></i>${esc(t.name)}<span style="margin-left:auto">${n} 天 · ${r[0] === r[1] ? md(r[0]) : `${md(r[0])}–${md(r[1])}`}</span></div>`;
          })
          .join("")}
      </div>
    </div>
    <div class="card"><h3>每周投入（大类 × 天）</h3>
      <div class="legend" style="margin-bottom:8px">${cats.map((c) => `<span class="chip" style="cursor:default"><i style="background:${c.color}"></i>${esc(c.name)}</span>`).join("")}</div>
      <div id="weekly-chart"></div>
      <div class="hint">每根柱子是一周，每段表示该大类在这周有记录的天数。</div>
    </div>
    ${dailyCards()}
  </div>`;

  root.querySelector(".page")!.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const cat = t.closest<HTMLElement>("[data-cat]")?.dataset.cat;
    if (cat) openPanel({ type: "cat", id: cat });
    const task = t.closest<HTMLElement>("[data-task]")?.dataset.task;
    if (task) openPanel({ type: "task", id: task, seg: null });
  });

  drawWeekly(root.querySelector("#weekly-chart")!, act, cats.map((c) => c.id));

  function dailyCards() {
    const dcats = p.categories.filter((c) => c.mode === "daily");
    if (!dcats.length) return "";
    return `<div class="grid2">${dcats
      .map((c) => {
        const cells = p.daily.filter((d) => d.cat === c.id);
        const total = Math.max(1, cells.length);
        return `<div class="card"><h3>${esc(c.name)} · ${cells.length} 天有记录</h3>${(c.tags ?? [])
          .map((tg, i) => {
            const n = cells.filter((d) => d.tag === tg.id).length;
            const alpha = [1, 0.68, 0.45, 0.3][Math.min(i, 3)];
            return `<div class="hbar"><span>${esc(tg.name)}</span><div class="track2"><i style="width:${(n / total) * 100}%;background:${c.color};opacity:${alpha}"></i></div><span class="n">${n} 天</span></div>`;
          })
          .join("")}</div>`;
      })
      .join("")}</div>`;
  }

  function drawWeekly(el: HTMLElement, act: Map<DateStr, { cats: Set<string> }>, order: string[]) {
    const first = weekStart(analyzed[0].date), last = weekStart(analyzed.at(-1)!.date);
    const weeks: DateStr[] = [];
    for (let w = first; w <= last; w = addDays(w, 7)) weeks.push(w);
    const data = weeks.map((w) => {
      const counts: Record<string, number> = {};
      for (let i = 0; i < 7; i++) for (const c of act.get(addDays(w, i))?.cats ?? []) counts[c] = (counts[c] ?? 0) + 1;
      return counts;
    });
    const totals = data.map((d) => Object.values(d).reduce((a, b) => a + b, 0));
    const maxV = Math.max(7, ...totals);
    const H = 220, padL = 30, padB = 24, padT = 8;
    const W = Math.max(480, weeks.length * 46 + padL);
    const bw = Math.min(30, ((W - padL) / weeks.length) * 0.6);
    const y = (v: number) => padT + (H - padT - padB) * (1 - v / maxV);
    const step = maxV > 28 ? 10 : 7;
    let svg = "";
    for (let v = 0; v <= maxV; v += step)
      svg += `<line x1="${padL}" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line-2)"/><text x="${padL - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
    weeks.forEach((w, i) => {
      const cx = padL + ((i + 0.5) * (W - padL)) / weeks.length;
      // 命中区域先画，色块盖在上面，悬停色块时能识别具体大类
      svg += `<rect x="${cx - bw / 2 - 6}" y="${padT}" width="${bw + 12}" height="${H - padT - padB}" fill="transparent" data-w="${i}"/>`;
      let acc = 0;
      for (const cid of order) {
        const v = data[i][cid];
        if (!v) continue;
        const c = p.categories.find((x) => x.id === cid)!;
        const y0 = y(acc), y1 = y(acc + v);
        // 段与段之间留 2px 表面色间隙
        svg += `<rect x="${cx - bw / 2}" y="${y1}" width="${bw}" height="${Math.max(0, y0 - y1 - 2)}" rx="2" fill="${c.color}" data-w="${i}" data-c="${cid}"/>`;
        acc += v;
      }
      if (weeks.length <= 16 || i % 2 === 0) svg += `<text x="${cx}" y="${H - 6}" text-anchor="middle">${md(w)}</text>`;
    });
    el.innerHTML = `<div style="overflow-x:auto"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="每周各大类投入天数">${svg}</svg></div>`;
    const svgEl = el.querySelector("svg")!;
    svgEl.addEventListener("mousemove", (e) => {
      const r = (e.target as Element).closest("[data-w]") as SVGElement | null;
      if (!r) return hideTip();
      const i = +r.dataset.w!;
      const rows = order
        .filter((c) => data[i][c])
        .map((cid) => {
          const c = p.categories.find((x) => x.id === cid)!;
          return `<div>${cid === r.dataset.c ? "<b>" : ""}<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${c.color};margin-right:6px"></span>${esc(c.name)}：${data[i][cid]} 天${cid === r.dataset.c ? "</b>" : ""}</div>`;
        })
        .join("");
      showTip(`<div class="t">${md(weeks[i])} – ${md(addDays(weeks[i], 6))} 这周</div>${rows || '<div class="s">无记录</div>'}`, e);
    });
    svgEl.addEventListener("mouseleave", hideTip);
  }
}
