import { chatJSON, isMock, type LLMSettings } from "./llm";
import { mockCategories, mockDay, mockWeekly } from "./mock";
import { categoryPrompt, dayPrompt, weeklyPrompt } from "./prompts";
import { getProject, nextColor } from "./store";
import type { Category, DateStr, DayAnalysis, DayOp, WeeklyReport } from "./types";
import { clip, uniqSorted } from "./util";

const str = (v: unknown, max = 60) => (typeof v === "string" ? clip(v.trim(), max) : "");
const slug = (v: unknown, fallback: string) => {
  const s = String(v ?? "").toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/^_+|_+$/g, "");
  return s || fallback;
};

/* ───── 分类 ───── */

export function sanitizeCategories(raw: any): Category[] {
  const arr: any[] = Array.isArray(raw?.categories) ? raw.categories : [];
  const out: Category[] = [];
  const used = new Set<string>();
  arr.forEach((c, i) => {
    const name = str(c?.name, 12);
    if (!name) return;
    let id = slug(c?.id, "cat" + i);
    while (used.has(id)) id += "_";
    used.add(id);
    const mode = c?.mode === "daily" ? "daily" : "bars";
    let tags = mode === "daily" && Array.isArray(c?.tags)
      ? c.tags.map((t: any, j: number) => ({ id: slug(t?.id, "t" + j), name: str(t?.name, 10) || String(t?.id ?? "") })).filter((t: any) => t.name)
      : undefined;
    if (mode === "daily" && !tags?.length) tags = [{ id: "done", name: "有记录" }];
    out.push({ id, name, mode, desc: str(c?.desc, 120) || undefined, tags, color: nextColor(out.map((x) => x.color)) });
  });
  return out;
}

export async function proposeCategories(s: LLMSettings, signal?: AbortSignal): Promise<Category[]> {
  const p = getProject();
  const raw = isMock(s) ? mockCategories() : await chatJSON(s, categoryPrompt(p), signal);
  const cats = sanitizeCategories(raw);
  if (!cats.length) throw new Error("模型没有给出可用的分类，请重试");
  return cats;
}

/* ───── 单日分析 ───── */

export function sanitizeDay(raw: any, date: DateStr): DayAnalysis {
  const p = getProject();
  const n = p.entries.find((e) => e.date === date)?.paras.length ?? 0;
  const paras = (v: unknown) =>
    uniqSorted((Array.isArray(v) ? v : []).map(Number).filter((x) => Number.isInteger(x) && x >= 0 && x < n));
  const barCats = new Set(p.categories.filter((c) => c.mode === "bars").map((c) => c.id));
  const taskIds = new Set(p.tasks.map((t) => t.id));

  const ops: DayOp[] = [];
  for (const o of Array.isArray(raw?.ops) ? raw.ops : []) {
    const ps = paras(o?.paras);
    if (!ps.length) continue;
    if (o?.type === "continue" && taskIds.has(o.task)) ops.push({ type: "continue", task: o.task, paras: ps, desc: str(o.desc, 120) || undefined });
    else if (o?.type === "new_stage" && taskIds.has(o.task) && str(o.stage))
      ops.push({ type: "new_stage", task: o.task, stage: str(o.stage, 20), paras: ps });
    else if (o?.type === "new_task" && str(o.name)) {
      // 模型给错大类时归到第一个 bars 大类，审阅时用户可以改
      const cat = barCats.has(o.cat) ? o.cat : [...barCats].at(-1);
      if (cat) ops.push({ type: "new_task", cat, name: str(o.name, 24), desc: str(o.desc, 120) || undefined, stage: str(o.stage, 20) || undefined, paras: ps });
    }
  }

  const daily: DayAnalysis["daily"] = [];
  for (const d of Array.isArray(raw?.daily) ? raw.daily : []) {
    const c = p.categories.find((x) => x.id === d?.cat && x.mode === "daily");
    if (!c) continue;
    const tag = c.tags?.some((t) => t.id === d.tag) ? d.tag : c.tags?.[0]?.id ?? "done";
    const exist = daily.find((x) => x.cat === c.id);
    if (exist) exist.paras = uniqSorted([...exist.paras, ...paras(d.paras)]);
    else daily.push({ cat: c.id, label: str(d.label, 12) || c.name, tag, paras: paras(d.paras) });
  }

  const mood = Math.round(Number(raw?.mood));
  return {
    date,
    ops,
    daily,
    mood: mood >= 1 && mood <= 5 ? mood : undefined,
    moodNote: str(raw?.moodNote, 40) || undefined,
    summary: str(raw?.summary, 80) || undefined,
  };
}

export async function analyzeDay(s: LLMSettings, date: DateStr, signal?: AbortSignal): Promise<DayAnalysis> {
  const p = getProject();
  if (!p.categoriesLocked) throw new Error("请先确认分类");
  const raw = isMock(s) ? mockDay(p, date) : await chatJSON(s, dayPrompt(p, date), signal);
  return sanitizeDay(raw, date);
}

/* ───── 周报 ───── */

export async function generateWeekly(s: LLMSettings, week: DateStr, signal?: AbortSignal): Promise<WeeklyReport> {
  const p = getProject();
  const raw = isMock(s) ? mockWeekly(p, week) : await chatJSON(s, weeklyPrompt(p, week), signal);
  const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => str(x, 120)).filter(Boolean).slice(0, 6) : []);
  return {
    week,
    title: str(raw?.title, 20) || "本周回顾",
    summary: str(raw?.summary, 600),
    highlights: list(raw?.highlights),
    concerns: list(raw?.concerns),
    generatedAt: Date.now(),
  };
}
