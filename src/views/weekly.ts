/** 周报：每周一张卡片，AI 生成文字总结 */
import { generateWeekly } from "../analyze";
import { isMock, loadSettings } from "../llm";
import { getProject, isReadOnly, update } from "../store";
import type { DateStr } from "../types";
import { addDays, esc, md, weekStart } from "../util";
import { toast } from "../ui/modal";
import { openSettings } from "../ui/settings";
import { moodPill } from "./detail";
import { dayActivity } from "./metrics";

const busy = new Set<DateStr>();

export function mountWeekly(root: HTMLElement) {
  const render = () => {
    const p = getProject();
    if (!p.entries.length) {
      root.innerHTML = `<div class="empty-state"><h2>还没有日记</h2></div>`;
      return;
    }
    const act = dayActivity();
    const weeks: DateStr[] = [];
    for (let w = weekStart(p.entries[0].date); w <= p.entries.at(-1)!.date; w = addDays(w, 7)) weeks.push(w);
    weeks.reverse();
    const ro = isReadOnly();
    const missing = weeks.filter((w) => !p.weekly[w] && hasAnalyzed(w));

    root.innerHTML = `<div class="page">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><div style="flex:1"><h2>周报</h2><div class="sub" style="margin:0">按自然周（周一至周日）汇总，由 AI 根据当周日记生成。</div></div>
      ${!ro && missing.length ? `<button class="btn primary" data-gen-all ${busy.size ? "disabled" : ""}>生成缺失的周报（${missing.length}）</button>` : ""}</div>
      <div style="margin-top:16px">${weeks.map((w) => weekCard(w)).join("")}</div></div>`;

    function hasAnalyzed(w: DateStr) {
      return p.entries.some((e) => e.date >= w && e.date <= addDays(w, 6) && p.days[e.date]?.analyzedAt);
    }

    function weekCard(w: DateStr) {
      const end = addDays(w, 6);
      const es = p.entries.filter((e) => e.date >= w && e.date <= end);
      const r = p.weekly[w];
      const moods = es.map((e) => p.days[e.date]?.mood).filter((m): m is number => !!m);
      const avg = moods.length ? Math.round(moods.reduce((a, b) => a + b, 0) / moods.length) : 0;
      const catCount = new Map<string, number>();
      for (let i = 0; i < 7; i++) for (const c of act.get(addDays(w, i))?.cats ?? []) catCount.set(c, (catCount.get(c) ?? 0) + 1);
      const topCats = [...catCount.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([id, n]) => `${esc(p.categories.find((c) => c.id === id)?.name ?? id)} ${n} 天`);
      const btn = ro || !es.length
        ? ""
        : busy.has(w)
          ? `<span class="btn sm" style="margin-left:auto"><span class="spinner"></span> 生成中</span>`
          : hasAnalyzed(w)
            ? `<button class="btn sm" data-gen="${w}">${r ? "重新生成" : "生成周报"}</button>`
            : `<span class="muted" style="margin-left:auto;font-size:12px">本周日记尚未分析</span>`;
      return `<div class="week">
        <div class="wh"><h3>${r ? esc(r.title) : `${md(w)} – ${md(end)}`}</h3><span class="r">${r ? `${w} ~ ${end}` : ""}</span>${btn}</div>
        <div class="stats"><span>日记 ${es.length} 篇</span>${avg ? `<span>平均状态 ${moodPill(avg)}</span>` : ""}${topCats.length ? `<span>${topCats.join(" · ")}</span>` : ""}</div>
        ${
          r
            ? `<p>${esc(r.summary)}</p>${r.highlights.length ? `<div class="lbl">本周完成</div><ul>${r.highlights.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>` : ""}${r.concerns.length ? `<div class="lbl">需要注意</div><ul>${r.concerns.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>` : ""}`
            : ""
        }
      </div>`;
    }
  };

  const gen = async (weeks: DateStr[]) => {
    const s = loadSettings();
    if (!isMock(s) && !s.apiKey) {
      toast("请先填写 API Key", true);
      return openSettings();
    }
    for (const w of weeks) busy.add(w);
    render();
    for (const w of weeks) {
      try {
        const r = await generateWeekly(s, w);
        update((p) => (p.weekly[w] = r));
      } catch (e) {
        toast(`${w} 周报生成失败：${(e as Error).message}`, true, 6000);
      }
      busy.delete(w);
      if (root.isConnected) render();
    }
  };

  root.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const w = t.closest<HTMLElement>("[data-gen]")?.dataset.gen;
    if (w && !busy.has(w)) gen([w]);
    if (t.closest("[data-gen-all]") && !busy.size) {
      const p = getProject();
      const all: DateStr[] = [];
      for (let x = weekStart(p.entries[0].date); x <= p.entries.at(-1)!.date; x = addDays(x, 7))
        if (!p.weekly[x] && p.entries.some((e) => e.date >= x && e.date <= addDays(x, 6) && p.days[e.date]?.analyzedAt)) all.push(x);
      gen(all);
    }
  });
  render();
  return { refresh: render };
}
