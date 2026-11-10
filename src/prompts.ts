import type { ChatMessage } from "./llm";
import type { Category, DateStr, Entry, Project } from "./types";
import { addDays, clip, diffDays, refDates, segRange, taskActiveDates, weekdayName } from "./util";

const entryText = (e: Entry, cap: number) => {
  const body = e.paras.join("\n");
  return `### ${e.date} ${weekdayName(e.date)}${e.label ? " " + e.label : ""}\n${clip(body, cap)}`;
};

/* ───── 1. 提议分类 ───── */

export function categoryPrompt(p: Project): ChatMessage[] {
  const BUDGET = 24000;
  let list = p.entries;
  // 日记很多时均匀抽样，保证覆盖整个时间段
  if (list.length > 40) {
    const step = list.length / 40;
    list = Array.from({ length: 40 }, (_, i) => list[Math.floor(i * step)]);
  }
  const cap = Math.max(300, Math.floor(BUDGET / Math.max(1, list.length)));
  const sys = `你是一位擅长整理个人日记的分析助手。用户会给你一批打卡/成长日记，你要为它们设计一套「大类」，用于之后把每天的内容归类到时间轴上。

大类有两种展示方式（mode）：
- "bars"：跨多天持续推进的事务，例如某个学习主题、某个项目、求职、课程。时间轴上画成横条，下面会再细分为具体子任务。
- "daily"：几乎每天都会重复记录的习惯或状态，例如运动、饮食、睡眠。时间轴上每天画一格，并用 tags 区分当天的类型。

要求：
1. 6–12 个大类，覆盖日记里反复出现的主要方向；名称简短（2–6 个字），彼此不重叠。
2. 每个大类写一句 desc，说明什么内容归入这里、和相近大类的边界。
3. 只有真正每天重复的习惯类才用 "daily"，并给出 2–4 个 tags（id 用英文小写，name 用中文），例如运动：力量训练 / 有氧 / 休息。
4. 最后放一个兜底的大类（如「其他事务」），收纳零散事项。
5. id 用简短的英文小写字母或下划线。

只输出 JSON，格式：
{"categories":[{"id":"study","name":"学习","mode":"bars","desc":"……"},{"id":"fit","name":"健身","mode":"daily","desc":"……","tags":[{"id":"gym","name":"力量训练"},{"id":"rest","name":"休息"}]}]}`;
  const user = `以下是 ${p.entries.length} 篇日记${list.length < p.entries.length ? `中均匀抽取的 ${list.length} 篇` : ""}：\n\n${list.map((e) => entryText(e, cap)).join("\n\n")}`;
  return [
    { role: "system", content: sys },
    { role: "user", content: user },
  ];
}

/* ───── 2. 单日增量分析 ───── */

const catLine = (c: Category) =>
  JSON.stringify({ id: c.id, name: c.name, mode: c.mode, desc: c.desc, ...(c.mode === "daily" ? { tags: c.tags } : {}) });

export function dayPrompt(p: Project, date: DateStr): ChatMessage[] {
  const entry = p.entries.find((e) => e.date === date)!;
  const barCats = new Set(p.categories.filter((c) => c.mode === "bars").map((c) => c.id));

  // 已有任务：近 30 天活跃的给出完整信息，更早的只给名字，方便模型判断「延续」还是「新建」
  const withLast = p.tasks
    .filter((t) => barCats.has(t.cat))
    .map((t) => {
      const ds = taskActiveDates(t).filter((d) => d !== date);
      return { t, last: ds.at(-1) ?? "" };
    })
    .filter((x) => x.last)
    .sort((a, b) => b.last.localeCompare(a.last));
  const recent = withLast.filter((x) => Math.abs(diffDays(x.last, date)) <= 30).slice(0, 60);
  const older = withLast.filter((x) => !recent.includes(x)).slice(0, 60);
  const taskLines = [
    ...recent.map(({ t, last }) =>
      JSON.stringify({
        id: t.id,
        cat: t.cat,
        name: t.name,
        desc: t.desc,
        stages: t.segments.map((s) => {
          const r = segRange(s);
          return r ? `${s.name}（${r[0].slice(5)}~${r[1].slice(5)}）` : s.name;
        }),
        last,
      }),
    ),
    ...older.map(({ t, last }) => JSON.stringify({ id: t.id, cat: t.cat, name: t.name, last })),
  ];

  const prevDays = [1, 2, 3]
    .map((n) => addDays(date, -n))
    .filter((d) => p.days[d]?.summary)
    .map((d) => `${d}：${p.days[d].summary}`);

  const sys = `你是一位细致的日记分析助手，负责把用户「某一天」的日记内容归入一条长期维护的时间轴。

时间轴结构：
- 大类（category）：分 "bars" 和 "daily" 两种。
- 任务（task）：只属于 bars 大类，代表「一件持续推进的事」，例如「NeetCode150 一刷」「RAG 项目优化」「秋招投递」。粒度适中：不要把每天的单个动作建成任务，也不要把整个大类当成一个任务。
- 阶段（stage）：任务内部的进展阶段，例如刷题任务的「动态规划」→「图论」。
- 每日格（daily）：daily 大类每天最多一格，用简短 label 概括当天，tag 表示类型。

对当天每个有实质内容的段落（用 [编号] 标出），给出归属：
1. 优先延续已有任务：同一件事继续推进时用 {"type":"continue"}；同一任务但内容方向明显进入新阶段时用 {"type":"new_stage"}，stage 写新阶段名（≤10 字）。
2. 只有当天出现了已有任务都不覆盖的新方向，才用 {"type":"new_task"}，写清 cat、name（≤14 字）、desc（一句话）和可选的首个阶段名 stage。
3. 一个段落可以同时归入多个任务；规划、心得类段落如果明确指向某个任务也可以引用；纯情绪或与任何事务无关的段落可以不归类。
4. daily 大类：当天有相关记录就输出一格，label ≤8 字，tag 必须是该大类 tags 里的 id。没有记录就不输出。
5. 只能使用给出的大类 id 和已有任务 id，不要编造。
6. 另外评估当天的情绪/状态 mood：1 很差、2 偏低、3 一般、4 不错、5 很好，moodNote 用 ≤20 字说明依据；summary 用 ≤40 字概括当天。

只输出 JSON，格式：
{"ops":[{"type":"continue","task":"已有任务id","paras":[0,1]},{"type":"new_stage","task":"已有任务id","stage":"阶段名","paras":[2]},{"type":"new_task","cat":"大类id","name":"任务名","desc":"一句话描述","stage":"首个阶段名","paras":[3]}],"daily":[{"cat":"daily大类id","label":"简短标签","tag":"tag id","paras":[4]}],"mood":3,"moodNote":"……","summary":"……"}`;

  const user = `## 大类
${p.categories.map(catLine).join("\n")}

## 已有任务（last = 最近一次活跃日期）
${taskLines.length ? taskLines.join("\n") : "（暂无，任务都需要新建）"}
${prevDays.length ? `\n## 前几天概要\n${prevDays.join("\n")}\n` : ""}
## 当天日记：${date} ${weekdayName(date)}${entry.label ? " " + entry.label : ""}
${entry.paras.map((t, i) => `[${i}] ${t}`).join("\n")}`;

  return [
    { role: "system", content: sys },
    { role: "user", content: user },
  ];
}

/* ───── 3. 周报 ───── */

export function weeklyPrompt(p: Project, week: DateStr): ChatMessage[] {
  const end = addDays(week, 6);
  const entries = p.entries.filter((e) => e.date >= week && e.date <= end);
  const cap = Math.max(600, Math.floor(14000 / Math.max(1, entries.length)));
  const touched = p.tasks
    .map((t) => {
      const stages = t.segments.filter((s) => refDates(s.refs).some((d) => d >= week && d <= end)).map((s) => s.name);
      return stages.length ? `- [${p.categories.find((c) => c.id === t.cat)?.name ?? t.cat}] ${t.name}：${stages.join(" → ")}` : "";
    })
    .filter(Boolean);
  const sys = `你是用户的成长教练，根据一周的日记写周报。语气客观、具体、简洁，用第二人称「你」，不要空泛的鼓励。

只输出 JSON：
{"title":"≤12 字的本周主题","summary":"3–5 句话总结本周的主要投入、进展和状态变化","highlights":["本周做成的具体事情，2–5 条"],"concerns":["值得注意的问题或下周建议，0–3 条"]}`;
  const user = `## 本周：${week} ~ ${end}

## 推进过的任务
${touched.join("\n") || "（无）"}

## 每天日记
${entries
  .map((e) => {
    const m = p.days[e.date];
    return `${entryText(e, cap)}${m?.mood ? `\n（状态 ${m.mood}/5：${m.moodNote ?? ""}）` : ""}`;
  })
  .join("\n\n")}`;
  return [
    { role: "system", content: sys },
    { role: "user", content: user },
  ];
}
