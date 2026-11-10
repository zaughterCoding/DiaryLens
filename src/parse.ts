import type { DateStr, Entry } from "./types";
import { makeDate } from "./util";

export interface ParsedFile {
  entry: Omit<Entry, "importedAt">;
  /** 日期从哪里识别出来的 */
  dateFrom: "meta" | "filename" | "content" | "manual" | "none";
}

const DATE_RE = /(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/;
const COMPACT_DATE_RE = /(?:^|\D)(\d{4})(\d{2})(\d{2})(?:\D|$)/;
const HASHTAG_LINE = /^(#[^\s#]+\s*)+$/;
const META_RE = /^\s*[-*]?\s*(日期|date|时间|day|天数|第几天|来源|source|链接|url|原帖|标题|title)\s*[:：]\s*(.+?)\s*$/i;
/** 纯结构性的标题，不当作正文 */
const STRUCT_HEADINGS = /^(正文|内容|日记|content|body|今日|今天)$/i;

export function findDate(s: string, allowCompact = false): DateStr | null {
  const m = s.match(DATE_RE);
  if (m) {
    const d = makeDate(+m[1], +m[2], +m[3]);
    if (d) return d;
  }
  if (allowCompact) {
    const c = s.match(COMPACT_DATE_RE);
    if (c) return makeDate(+c[1], +c[2], +c[3]);
  }
  return null;
}

const mdLinkUrl = (v: string) => v.match(/\((https?:\/\/[^)\s]+)\)/)?.[1] ?? v.match(/https?:\/\/\S+/)?.[0];

/** 解析一篇日记文本。约定：一个文件 = 一天。 */
export function parseDiary(text: string, filename = ""): ParsedFile {
  let body = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  // YAML front matter
  const meta: Record<string, string> = {};
  const fm = body.match(/^---\n([\s\S]*?)\n---\n/);
  if (fm) {
    for (const line of fm[1].split("\n")) {
      const m = line.match(/^\s*([\w一-龥]+)\s*:\s*(.+)$/);
      if (m) meta[m[1].toLowerCase()] = m[2].replace(/^["']|["']$/g, "");
    }
    body = body.slice(fm[0].length);
  }

  let title: string | undefined;
  const paras: string[] = [];
  const hashtags: string[] = [];
  let inHeader = true;
  for (const raw of body.split("\n")) {
    const s = raw.trim();
    if (!s) continue;
    const h = s.match(/^#{1,6}\s+(.+)$/);
    if (h) {
      const ht = h[1].trim();
      if (!title && /^#\s/.test(s) && paras.length === 0) title = ht;
      else if (!STRUCT_HEADINGS.test(ht)) paras.push(ht);
      continue;
    }
    if (inHeader) {
      const m = s.match(META_RE);
      if (m) {
        meta[m[1].toLowerCase()] = m[2];
        continue;
      }
      inHeader = false;
    }
    if (HASHTAG_LINE.test(s)) {
      hashtags.push(...s.split(/\s+/).filter(Boolean));
      continue;
    }
    paras.push(s);
  }

  let date: DateStr | null = null;
  let dateFrom: ParsedFile["dateFrom"] = "none";
  const metaDate = meta["日期"] ?? meta["date"] ?? meta["时间"];
  if (metaDate && (date = findDate(metaDate, true))) dateFrom = "meta";
  else if (filename && (date = findDate(filename, true))) dateFrom = "filename";
  else if ((date = findDate([title ?? "", ...paras.slice(0, 3)].join("\n")))) dateFrom = "content";

  const dayNo = meta["day"] ?? meta["天数"] ?? meta["第几天"];
  const label = dayNo && /^\d+$/.test(dayNo.trim()) ? `Day${dayNo.trim()}` : dayNo?.trim() || undefined;
  const urlRaw = meta["来源"] ?? meta["source"] ?? meta["链接"] ?? meta["url"] ?? meta["原帖"];

  return {
    entry: {
      date: date ?? "",
      label,
      title: title ?? meta["标题"] ?? meta["title"],
      url: urlRaw ? mdLinkUrl(urlRaw) : undefined,
      paras,
      hashtags: hashtags.length ? hashtags : undefined,
      source: filename || undefined,
    },
    dateFrom,
  };
}

/** 网页里粘贴的正文：日期由用户选择 */
export function parsePasted(text: string, date: DateStr): Omit<Entry, "importedAt"> {
  const { entry } = parseDiary(text);
  return { ...entry, date, source: "粘贴" };
}
