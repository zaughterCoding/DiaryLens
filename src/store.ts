import type { Category, DateStr, DayAnalysis, Entry, Project, Task } from "./types";
import { PALETTE, refDates, uid, uniqSorted } from "./util";

/* ───── IndexedDB：只存一个 key = "project" ───── */

const DB_NAME = "diarylens";
const STORE = "kv";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const r = db.transaction(STORE).objectStore(STORE).get(key);
    r.onsuccess = () => resolve(r.result as T);
    r.onerror = () => reject(r.error);
  });
}
async function idbSet(key: string, val: unknown) {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(val, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function emptyProject(): Project {
  const now = Date.now();
  return {
    version: 1,
    name: "我的日记",
    entries: [],
    categories: [],
    categoriesLocked: false,
    tasks: [],
    daily: [],
    days: {},
    weekly: {},
    createdAt: now,
    updatedAt: now,
  };
}

/** 校验并补齐导入的项目 JSON */
export function normalizeProject(raw: any): Project {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.entries)) throw new Error("不是有效的 DiaryLens 项目文件");
  const p = { ...emptyProject(), ...raw } as Project;
  p.entries = [...p.entries].sort((a, b) => a.date.localeCompare(b.date));
  return p;
}

/* ───── 全局状态 ───── */

type Listener = () => void;
let project: Project = emptyProject();
let readOnly = false;
const listeners = new Set<Listener>();
let saveTimer: number | undefined;

export const getProject = () => project;
export const isReadOnly = () => readOnly;
export const subscribe = (fn: Listener) => (listeners.add(fn), () => listeners.delete(fn));

function changed(persist = true) {
  project.updatedAt = Date.now();
  if (persist && !readOnly) {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => idbSet("project", project).catch((e) => console.error("保存失败", e)), 200);
  }
  listeners.forEach((fn) => fn());
}

export async function loadProject(embedded?: Project) {
  if (embedded) {
    project = normalizeProject(embedded);
    readOnly = true;
  } else {
    const saved = await idbGet<Project>("project").catch(() => undefined);
    project = saved ? normalizeProject(saved) : emptyProject();
  }
  changed(false);
}

export function replaceProject(p: Project) {
  project = normalizeProject(p);
  changed();
}

export function update(fn: (p: Project) => void) {
  fn(project);
  changed();
}

/* ───── 查询 ───── */

export const entryOf = (date: DateStr) => project.entries.find((e) => e.date === date);
export const catOf = (id: string) => project.categories.find((c) => c.id === id);
export const taskOf = (id: string) => project.tasks.find((t) => t.id === id);
export const isAnalyzed = (date: DateStr) => !!project.days[date]?.analyzedAt;
export const pendingDates = () => project.entries.filter((e) => !isAnalyzed(e.date)).map((e) => e.date);

/* ───── 日记 ───── */

export function upsertEntries(list: Omit<Entry, "importedAt">[]) {
  update((p) => {
    for (const e of list) {
      const i = p.entries.findIndex((x) => x.date === e.date);
      if (i >= 0) {
        // 覆盖已有日期：旧的段落号已失效，清掉这一天的分析结果
        clearDayAnalysis(p, e.date);
        p.entries[i] = { ...e, importedAt: Date.now() };
      } else p.entries.push({ ...e, importedAt: Date.now() });
    }
    p.entries.sort((a, b) => a.date.localeCompare(b.date));
  });
}

export function deleteEntry(date: DateStr) {
  update((p) => {
    clearDayAnalysis(p, date);
    p.entries = p.entries.filter((e) => e.date !== date);
  });
}

/** 移除某天的全部分析痕迹（任务引用、每日格、情绪摘要）；空掉的阶段与任务一并删除 */
export function clearDayAnalysis(p: Project, date: DateStr) {
  for (const t of p.tasks) {
    for (const s of t.segments) delete s.refs[date];
    t.segments = t.segments.filter((s) => refDates(s.refs).length);
  }
  p.tasks = p.tasks.filter((t) => t.segments.length);
  p.daily = p.daily.filter((c) => c.date !== date);
  delete p.days[date];
}

/* ───── 分类 ───── */

export function setCategories(cats: Category[], lock: boolean) {
  update((p) => {
    p.categories = cats;
    p.categoriesLocked = lock;
  });
}

export function nextColor(used: string[]) {
  return PALETTE.find((c) => !used.includes(c)) ?? PALETTE[used.length % PALETTE.length];
}

/* ───── 合并单日分析 ───── */

export function applyAnalysis(a: DayAnalysis) {
  update((p) => {
    clearDayAnalysis(p, a.date);
    for (const op of a.ops) {
      if (!op.paras.length) continue;
      if (op.type === "new_task") {
        const t: Task = {
          id: uid("t_"),
          cat: op.cat,
          name: op.name,
          desc: op.desc,
          segments: [{ name: op.stage || op.name, refs: { [a.date]: uniqSorted(op.paras) } }],
        };
        p.tasks.push(t);
        continue;
      }
      const t = p.tasks.find((x) => x.id === op.task);
      if (!t) continue;
      if (op.type === "continue") {
        // 延续：并入最后一个阶段
        const s = lastSegment(t);
        s.refs[a.date] = uniqSorted([...(s.refs[a.date] ?? []), ...op.paras]);
        if (op.desc) t.desc = op.desc;
      } else {
        const exist = t.segments.find((s) => s.name === op.stage);
        if (exist) exist.refs[a.date] = uniqSorted([...(exist.refs[a.date] ?? []), ...op.paras]);
        else t.segments.push({ name: op.stage, refs: { [a.date]: uniqSorted(op.paras) } });
      }
    }
    for (const d of a.daily) p.daily.push({ ...d, date: a.date, paras: uniqSorted(d.paras) });
    p.days[a.date] = { mood: a.mood, moodNote: a.moodNote, summary: a.summary, analyzedAt: Date.now() };
  });
}

/** 按最晚引用日期排序后的最后一个阶段 */
export function lastSegment(t: Task) {
  return [...t.segments].sort((a, b) => (refDates(a.refs).at(-1) ?? "").localeCompare(refDates(b.refs).at(-1) ?? "")).at(-1)!;
}
