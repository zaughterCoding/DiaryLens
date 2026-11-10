/** 演示模式：不调用任何接口，用关键词规则粗略模拟模型输出，只为体验界面 */
import type { DateStr, Project } from "./types";
import { addDays, diffDays, taskActiveDates } from "./util";

const RULES: { cat: string; re: RegExp }[] = [
  { cat: "fit", re: /健身|跑步|跑了|游泳|瑜伽|gym|训练|有氧|力量|球|骑行|徒步|拉伸/i },
  { cat: "food", re: /做饭|早餐|午饭|晚饭|外卖|吃了|食堂|备餐|饮食/ },
  { cat: "study", re: /学|课|读|书|chapter|章|题|leetcode|neetcode|八股|复习|笔记|论文|单词/i },
  { cat: "project", re: /项目|开发|代码|实现|重构|bug|上线|部署|功能|benchmark|commit|PR/i },
  { cat: "career", re: /面试|简历|投递|offer|内推|招聘|笔试|实习/i },
  { cat: "fun", re: /游戏|电影|看剧|综艺|追番|聚会|出去玩|散步/ },
];

export function mockCategories() {
  return {
    categories: [
      { id: "study", name: "学习", mode: "bars", desc: "课程、读书、刷题等学习主题" },
      { id: "project", name: "项目", mode: "bars", desc: "个人或工作项目的开发推进" },
      { id: "career", name: "求职", mode: "bars", desc: "投递、面试、简历" },
      { id: "fun", name: "娱乐", mode: "bars", desc: "游戏、影视、社交" },
      { id: "misc", name: "其他事务", mode: "bars", desc: "零散事项" },
      { id: "fit", name: "运动", mode: "daily", desc: "当天的运动", tags: [{ id: "train", name: "训练" }, { id: "rest", name: "休息" }] },
      { id: "food", name: "饮食", mode: "daily", desc: "当天的饮食", tags: [{ id: "home", name: "自己做" }, { id: "out", name: "外食" }] },
    ],
  };
}

export function mockDay(p: Project, date: DateStr) {
  const entry = p.entries.find((e) => e.date === date)!;
  const ops: any[] = [];
  const daily: any[] = [];
  const has = (id: string) => p.categories.some((c) => c.id === id);
  entry.paras.forEach((text, i) => {
    const rule = RULES.find((r) => r.re.test(text) && has(r.cat));
    const cat = rule?.cat ?? (has("misc") && text.length > 12 ? "misc" : null);
    if (!cat) return;
    const c = p.categories.find((x) => x.id === cat)!;
    if (c.mode === "daily") {
      const ex = daily.find((d) => d.cat === cat);
      if (ex) ex.paras.push(i);
      else daily.push({ cat, label: text.replace(/^[\d.、\s]+/, "").slice(0, 8), tag: c.tags?.[0]?.id, paras: [i] });
      return;
    }
    // 同一大类 7 天内活跃过的任务视为延续
    const recent = p.tasks.find((t) => t.cat === cat && taskActiveDates(t).some((d) => d < date && diffDays(d, date) <= 7));
    const ex = ops.find((o) => (o.task && o.task === recent?.id) || (o.type === "new_task" && o.cat === cat));
    if (ex) ex.paras.push(i);
    else if (recent) ops.push({ type: "continue", task: recent.id, paras: [i] });
    else ops.push({ type: "new_task", cat, name: text.replace(/^[\d.、\s]+/, "").slice(0, 10), desc: "（演示模式自动生成）", paras: [i] });
  });
  const pos = entry.paras.join("").match(/开心|顺利|不错|满意|完成/g)?.length ?? 0;
  const neg = entry.paras.join("").match(/累|焦虑|烦|难|崩|失败|拖延/g)?.length ?? 0;
  return {
    ops,
    daily,
    mood: Math.max(1, Math.min(5, 3 + pos - neg)),
    moodNote: `正面词 ${pos} 个，负面词 ${neg} 个`,
    summary: (entry.paras.find((t) => t.length > 6) ?? "").slice(0, 36),
  };
}

export function mockWeekly(p: Project, week: DateStr) {
  const end = addDays(week, 6);
  const days = p.entries.filter((e) => e.date >= week && e.date <= end);
  return {
    title: `本周记录 ${days.length} 天`,
    summary: `演示模式：本周共有 ${days.length} 篇日记。配置真实模型后，这里会生成基于内容的周报。`,
    highlights: days.map((d) => p.days[d.date]?.summary).filter(Boolean).slice(0, 4),
    concerns: [],
  };
}
