import { catOf, entryOf, getProject, lastSegment, taskOf } from "../store";
import type { DayAnalysis, DayOp } from "../types";
import { esc, hex2rgba, taskRange, weekdayName } from "../util";
import type { ModalHandle } from "./modal";

/** 审阅界面中可编辑的条目 */
interface EditOp {
  on: boolean;
  type: DayOp["type"];
  task: string;
  stage: string;
  cat: string;
  name: string;
  desc: string;
  paras: number[];
}
interface EditDaily {
  on: boolean;
  cat: string;
  label: string;
  tag: string;
  paras: number[];
}

export interface ReviewState {
  ops: EditOp[];
  daily: EditDaily[];
  mood?: number;
  moodNote: string;
  summary: string;
}

export function toReviewState(a: DayAnalysis): ReviewState {
  return {
    ops: a.ops.map((o) => ({
      on: true,
      type: o.type,
      task: "task" in o ? o.task : "",
      stage: "stage" in o ? o.stage ?? "" : "",
      cat: o.type === "new_task" ? o.cat : taskOf((o as any).task)?.cat ?? "",
      name: o.type === "new_task" ? o.name : "",
      desc: o.type === "new_task" ? o.desc ?? "" : o.type === "continue" ? o.desc ?? "" : "",
      paras: o.paras,
    })),
    daily: a.daily.map((d) => ({ on: true, ...d })),
    mood: a.mood,
    moodNote: a.moodNote ?? "",
    summary: a.summary ?? "",
  };
}

export function fromReviewState(date: string, s: ReviewState): DayAnalysis {
  const ops: DayOp[] = [];
  for (const o of s.ops) {
    if (!o.on || !o.paras.length) continue;
    if (o.type === "new_task") {
      if (o.name.trim()) ops.push({ type: "new_task", cat: o.cat, name: o.name.trim(), desc: o.desc.trim() || undefined, stage: o.stage.trim() || undefined, paras: o.paras });
    } else if (taskOf(o.task)) {
      if (o.type === "continue") ops.push({ type: "continue", task: o.task, paras: o.paras, desc: o.desc.trim() || undefined });
      else if (o.stage.trim()) ops.push({ type: "new_stage", task: o.task, stage: o.stage.trim(), paras: o.paras });
    }
  }
  return {
    date,
    ops,
    daily: s.daily.filter((d) => d.on).map(({ cat, label, tag, paras }) => ({ cat, label, tag, paras })),
    mood: s.mood,
    moodNote: s.moodNote || undefined,
    summary: s.summary || undefined,
  };
}

const KIND: Record<DayOp["type"], string> = { continue: "延续任务", new_stage: "任务新阶段", new_task: "新建任务" };
const MOODS = ["", "1 很差", "2 偏低", "3 一般", "4 不错", "5 很好"];

/** 在弹窗里渲染审阅内容；所有编辑直接写回 state */
export function renderReview(m: ModalHandle, date: string, s: ReviewState) {
  const p = getProject();
  const entry = entryOf(date)!;
  const barCats = p.categories.filter((c) => c.mode === "bars");
  // 任务下拉：按大类分组，最近活跃的排前面
  const taskOptions = (sel: string) =>
    barCats
      .map((c) => {
        const ts = p.tasks
          .filter((t) => t.cat === c.id)
          .sort((a, b) => (taskRange(b)?.[1] ?? "").localeCompare(taskRange(a)?.[1] ?? ""));
        return ts.length
          ? `<optgroup label="${esc(c.name)}">${ts.map((t) => `<option value="${t.id}" ${t.id === sel ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</optgroup>`
          : "";
      })
      .join("");
  const catOptions = (sel: string) => barCats.map((c) => `<option value="${c.id}" ${c.id === sel ? "selected" : ""}>${esc(c.name)}</option>`).join("");

  // 段落着色：显示每段被哪个大类引用
  const paraColor = new Map<number, string>();
  s.ops.forEach((o) => {
    if (!o.on) return;
    const color = catOf(o.type === "new_task" ? o.cat : taskOf(o.task)?.cat ?? "")?.color;
    if (color) o.paras.forEach((i) => paraColor.has(i) || paraColor.set(i, color));
  });
  s.daily.forEach((d) => d.on && d.paras.forEach((i) => paraColor.has(i) || paraColor.set(i, catOf(d.cat)?.color ?? "")));

  const paraList = entry.paras
    .map((t, i) => {
      const c = paraColor.get(i);
      return `<div class="p ${c ? "" : "unused"}" style="${c ? `border-left-color:${c};background:${hex2rgba(c, 0.08)}` : ""}"><b>[${i}]</b>${esc(t)}</div>`;
    })
    .join("");

  const opHTML = (o: EditOp, i: number) => {
    const t = taskOf(o.task);
    const c = catOf(o.type === "new_task" ? o.cat : t?.cat ?? "");
    let fields = "";
    if (o.type === "new_task") {
      fields = `<select data-op="${i}" data-f="cat">${catOptions(o.cat)}</select>
        <input type="text" data-op="${i}" data-f="name" value="${esc(o.name)}" placeholder="任务名">
        <input type="text" data-op="${i}" data-f="stage" value="${esc(o.stage)}" placeholder="首个阶段名（可选）">
        <input type="text" data-op="${i}" data-f="desc" value="${esc(o.desc)}" placeholder="一句话描述" style="flex-basis:100%">`;
    } else {
      fields = `<select data-op="${i}" data-f="task">${taskOptions(o.task)}</select>` +
        (o.type === "new_stage" ? `<input type="text" data-op="${i}" data-f="stage" value="${esc(o.stage)}" placeholder="新阶段名">` : "");
    }
    return `<div class="op ${o.on ? "" : "off"}" style="border-left:3px solid ${c?.color ?? "var(--line)"}">
      <div class="oh"><label class="check"><input type="checkbox" data-op="${i}" data-f="on" ${o.on ? "checked" : ""}></label>
        <select data-op="${i}" data-f="type" style="font-size:12px;padding:2px 4px">${(Object.keys(KIND) as DayOp["type"][])
          .filter((k) => k === "new_task" || p.tasks.length)
          .map((k) => `<option value="${k}" ${k === o.type ? "selected" : ""}>${KIND[k]}</option>`)
          .join("")}</select>
        ${c ? `<span class="kind" style="color:${c.color}">${esc(c.name)}</span>` : ""}
        ${o.type !== "new_task" && t ? `<span class="muted" style="font-size:12px">当前阶段：${esc(lastSegment(t).name)}</span>` : ""}
      </div>
      <div class="fields">${fields}</div>
      <div class="pr">引用段落：${o.paras.map((x) => `[${x}]`).join(" ")}</div>
    </div>`;
  };

  const dailyHTML = (d: EditDaily, i: number) => {
    const c = catOf(d.cat)!;
    return `<div class="op ${d.on ? "" : "off"}" style="border-left:3px solid ${c.color}">
      <div class="oh"><label class="check"><input type="checkbox" data-daily="${i}" data-f="on" ${d.on ? "checked" : ""}></label><span class="kind" style="color:${c.color}">${esc(c.name)}</span></div>
      <div class="fields"><input type="text" data-daily="${i}" data-f="label" value="${esc(d.label)}" placeholder="简短标签">
        <select data-daily="${i}" data-f="tag">${(c.tags ?? []).map((t) => `<option value="${t.id}" ${t.id === d.tag ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select></div>
      <div class="pr">引用段落：${d.paras.map((x) => `[${x}]`).join(" ")}</div>
    </div>`;
  };

  const unused = entry.paras.length - paraColor.size;
  m.setBody(`<div class="rv-day">
    <div><div class="rv-sec">${date} ${weekdayName(date)}${entry.label ? " · " + esc(entry.label) : ""} · 原文 ${entry.paras.length} 段${unused ? `，<span class="warn">${unused} 段未归类</span>` : ""}</div>
      <div class="rv-paras">${paraList}</div></div>
    <div>
      <div class="rv-sec">任务（${s.ops.filter((o) => o.on).length}/${s.ops.length}）</div>
      ${s.ops.map(opHTML).join("") || `<div class="muted">没有任务变更</div>`}
      <div class="rv-sec">每日格</div>
      ${s.daily.map(dailyHTML).join("") || `<div class="muted">无</div>`}
      <div class="rv-sec">状态与概要</div>
      <div class="op"><div class="fields">
        <select data-f="mood">${MOODS.map((t, v) => `<option value="${v}" ${v === (s.mood ?? 0) ? "selected" : ""}>${v ? t : "未评估"}</option>`).join("")}</select>
        <input type="text" data-f="moodNote" value="${esc(s.moodNote)}" placeholder="状态依据">
        <input type="text" data-f="summary" value="${esc(s.summary)}" placeholder="当天一句话概要" style="flex-basis:100%">
      </div></div>
    </div></div>`);
}

/** 绑定审阅界面的编辑事件（只绑一次） */
export function bindReview(m: ModalHandle, get: () => { date: string; s: ReviewState } | null) {
  const onEdit = (e: Event, structural: boolean) => {
    const cur = get();
    if (!cur) return;
    const t = e.target as HTMLInputElement;
    const f = t.dataset.f;
    if (!f) return;
    const val = t.type === "checkbox" ? t.checked : t.value;
    if (t.dataset.op) {
      const o = cur.s.ops[+t.dataset.op] as any;
      if (f === "type") {
        o.type = val;
        if (val !== "new_task" && !o.task) o.task = getProject().tasks.find((x) => x.cat === o.cat)?.id ?? getProject().tasks[0]?.id ?? "";
        if (val === "new_task" && !o.cat) o.cat = taskOf(o.task)?.cat ?? "";
        if (val === "new_task" && !o.name) o.name = taskOf(o.task)?.name ?? "";
      } else o[f] = val;
    } else if (t.dataset.daily) (cur.s.daily[+t.dataset.daily] as any)[f] = val;
    else if (f === "mood") cur.s.mood = Number(val) || undefined;
    else if (f === "moodNote" || f === "summary") cur.s[f] = String(val);
    if (structural) renderReview(m, cur.date, cur.s);
  };
  m.body.addEventListener("input", (e) => {
    const t = e.target as HTMLElement;
    if (t.tagName === "INPUT" && (t as HTMLInputElement).type === "text") onEdit(e, false);
  });
  m.body.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.type === "text") return;
    onEdit(e, ["on", "type", "task", "cat"].includes(t.dataset.f ?? ""));
  });
}
