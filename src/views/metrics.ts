import { getProject } from "../store";
import type { DateStr } from "../types";
import { refDates } from "../util";

export interface DayActivity {
  /** 当天涉及的大类 */
  cats: Set<string>;
  /** 当天推进的任务数 + 每日格数 */
  items: number;
  /** 被归类的段落数 */
  paras: number;
}

/** 汇总每天的活动情况（只统计已分析的日子） */
export function dayActivity(): Map<DateStr, DayActivity> {
  const p = getProject();
  const map = new Map<DateStr, DayActivity>();
  const get = (d: DateStr) => {
    if (!map.has(d)) map.set(d, { cats: new Set(), items: 0, paras: 0 });
    return map.get(d)!;
  };
  const paraSets = new Map<DateStr, Set<number>>();
  const addParas = (d: DateStr, ps: number[]) => {
    if (!paraSets.has(d)) paraSets.set(d, new Set());
    ps.forEach((x) => paraSets.get(d)!.add(x));
  };
  for (const t of p.tasks) {
    const seen = new Set<DateStr>();
    for (const s of t.segments)
      for (const d of refDates(s.refs)) {
        addParas(d, s.refs[d]);
        if (seen.has(d)) continue;
        seen.add(d);
        const a = get(d);
        a.cats.add(t.cat);
        a.items++;
      }
  }
  for (const c of p.daily) {
    const a = get(c.date);
    a.cats.add(c.cat);
    a.items++;
    addParas(c.date, c.paras);
  }
  for (const [d, s] of paraSets) get(d).paras = s.size;
  return map;
}
