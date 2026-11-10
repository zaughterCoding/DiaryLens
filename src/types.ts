/** 日期统一用 YYYY-MM-DD 字符串 */
export type DateStr = string;

/** 一天的日记 */
export interface Entry {
  date: DateStr;
  /** 可选的显示标签，如 "Day1"（从正文元数据 `Day：1` 解析） */
  label?: string;
  title?: string;
  /** 原帖 / 来源链接 */
  url?: string;
  /** 正文按非空行切分的段落，下标即段落号 */
  paras: string[];
  /** 纯话题标签行（#xxx #yyy），不参与分析 */
  hashtags?: string[];
  source?: string;
  importedAt: number;
}

export interface DailyTag {
  id: string;
  name: string;
}

export interface Category {
  id: string;
  name: string;
  color: string;
  /** bars：跨天横条（项目、学习主题）；daily：每天一格（运动、饮食） */
  mode: "bars" | "daily";
  desc?: string;
  /** daily 类的状态类型 */
  tags?: DailyTag[];
}

/** 段落引用：{ 日期: [段落号] } */
export type Refs = Record<DateStr, number[]>;

export interface Segment {
  name: string;
  /** 阶段的起止由 refs 中最早/最晚日期推导 */
  refs: Refs;
}

export interface Task {
  id: string;
  cat: string;
  name: string;
  desc?: string;
  segments: Segment[];
}

export interface DailyCell {
  cat: string;
  date: DateStr;
  label: string;
  tag: string;
  paras: number[];
}

export interface DayMeta {
  /** 1–5 */
  mood?: number;
  moodNote?: string;
  summary?: string;
  analyzedAt?: number;
}

export interface WeeklyReport {
  /** 周一日期 */
  week: DateStr;
  title: string;
  summary: string;
  highlights: string[];
  concerns: string[];
  generatedAt: number;
}

export interface Project {
  version: 1;
  name: string;
  entries: Entry[];
  categories: Category[];
  categoriesLocked: boolean;
  tasks: Task[];
  daily: DailyCell[];
  days: Record<DateStr, DayMeta>;
  weekly: Record<DateStr, WeeklyReport>;
  createdAt: number;
  updatedAt: number;
}

/* ───── AI 返回的单日分析（经校验后） ───── */

export type DayOp =
  | { type: "continue"; task: string; paras: number[]; desc?: string }
  | { type: "new_stage"; task: string; stage: string; paras: number[] }
  | { type: "new_task"; cat: string; name: string; desc?: string; stage?: string; paras: number[] };

export interface DayAnalysis {
  date: DateStr;
  ops: DayOp[];
  daily: Omit<DailyCell, "date">[];
  mood?: number;
  moodNote?: string;
  summary?: string;
}

export interface CategoryProposal {
  categories: Omit<Category, "color">[];
}
