import type { DateStr, Refs, Segment, Task } from "./types";

export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export const uid = (p = "") => p + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);

/* ───── 日期 ───── */

const pad = (n: number) => String(n).padStart(2, "0");
export const toDateStr = (d: Date): DateStr => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromDateStr = (s: DateStr) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
export const addDays = (s: DateStr, n: number) => {
  const d = fromDateStr(s);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
};
export const diffDays = (a: DateStr, b: DateStr) =>
  Math.round((fromDateStr(b).getTime() - fromDateStr(a).getTime()) / 86400000);
export const isValidDate = (y: number, m: number, d: number) => {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const t = new Date(y, m - 1, d);
  return t.getMonth() === m - 1 && t.getDate() === d;
};
export const makeDate = (y: number, m: number, d: number): DateStr | null =>
  isValidDate(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : null;

const WEEK = "日一二三四五六";
export const weekdayName = (s: DateStr) => "周" + WEEK[fromDateStr(s).getDay()];
export const isWeekend = (s: DateStr) => [0, 6].includes(fromDateStr(s).getDay());
export const md = (s: DateStr) => {
  const d = fromDateStr(s);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};
/** 所在周的周一 */
export const weekStart = (s: DateStr) => {
  const d = fromDateStr(s);
  const off = (d.getDay() + 6) % 7;
  return addDays(s, -off);
};
export function dateRange(a: DateStr, b: DateStr): DateStr[] {
  const out: DateStr[] = [];
  for (let s = a; s <= b; s = addDays(s, 1)) out.push(s);
  return out;
}

/* ───── 任务 / 阶段推导 ───── */

export const refDates = (refs: Refs) => Object.keys(refs).filter((d) => refs[d]?.length).sort();
export function segRange(s: Segment): [DateStr, DateStr] | null {
  const ds = refDates(s.refs);
  return ds.length ? [ds[0], ds[ds.length - 1]] : null;
}
export function taskRange(t: Task): [DateStr, DateStr] | null {
  const ds = taskActiveDates(t);
  return ds.length ? [ds[0], ds[ds.length - 1]] : null;
}
export function taskActiveDates(t: Task): DateStr[] {
  return [...new Set(t.segments.flatMap((s) => refDates(s.refs)))].sort();
}
export const uniqSorted = (a: number[]) => [...new Set(a)].sort((x, y) => x - y);

/* ───── 颜色 ───── */

// 前 8 个为经过色觉障碍校验的分类色顺序（按序分配，不循环）；之后为补充色
export const PALETTE = [
  "#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948",
  "#78909C", "#8D6E63", "#00897B", "#5C6BC0", "#AB47BC", "#6D4C41",
];
export function hex2rgba(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/* ───── 杂项 ───── */

export function download(name: string, content: string, type = "application/json") {
  const blob = new Blob([content], { type: type + ";charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) =>
  root.querySelector(sel) as T;
export const $$ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) =>
  [...root.querySelectorAll(sel)] as T[];

export const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);
