import { analyzeDay } from "../analyze";
import { isMock, loadSettings, usage } from "../llm";
import { applyAnalysis, getProject } from "../store";
import type { DateStr } from "../types";
import { esc } from "../util";
import { openModal, toast } from "./modal";
import { bindReview, fromReviewState, renderReview, toReviewState, type ReviewState } from "./review";
import { openSettings } from "./settings";

let running = false;
const LS_AUTO = "diarylens.autoMerge";

/**
 * 按日期顺序逐天分析：每天的结果先审阅再合并（也可勾选自动合并）。
 * 必须串行：后一天的分析依赖前一天合并后的任务列表。
 */
export async function runAnalysis(dates: DateStr[], onChange?: () => void) {
  if (running) return toast("已有分析在进行中");
  const p = getProject();
  if (!p.categoriesLocked) return toast("请先确认分类", true);
  const s = loadSettings();
  if (!isMock(s) && !s.apiKey) {
    toast("请先填写 API Key", true);
    return openSettings();
  }
  dates = [...dates].sort();
  if (!dates.length) return toast("没有需要分析的日记");

  running = true;
  let auto = false;
  try {
    auto = localStorage.getItem(LS_AUTO) === "1";
  } catch {
    /* ignore */
  }
  let stop = false;
  let ctrl = new AbortController();
  let merged = 0, skipped = 0;
  let current: { date: string; s: ReviewState } | null = null;
  let resolveAct: ((act: string) => void) | null = null;
  const waitAct = () => new Promise<string>((r) => (resolveAct = r));

  const m = openModal({
    title: "分析日记",
    body: "",
    wide: true,
    onClose: () => {
      stop = true;
      ctrl.abort();
      resolveAct?.("stop");
    },
  });
  bindReview(m, () => current);
  m.foot.addEventListener("click", (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>("[data-act]")?.dataset.act;
    if (!act) return;
    if (act === "stop") {
      stop = true;
      ctrl.abort();
    }
    resolveAct?.(act);
  });
  m.foot.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.name === "auto") {
      auto = t.checked;
      try {
        localStorage.setItem(LS_AUTO, auto ? "1" : "0");
      } catch {
        /* ignore */
      }
    }
  });
  const autoBox = () => `<label class="check" style="margin-right:auto;font-size:12px"><input type="checkbox" name="auto" ${auto ? "checked" : ""}> 自动合并，不逐天审阅</label>`;
  const tokenNote = () => (usage.calls ? `本次会话已调用 ${usage.calls} 次 · ${usage.prompt + usage.completion} tokens` : "");

  for (let i = 0; i < dates.length && !stop; i++) {
    const date = dates[i];
    const progress = `<div class="progress"><i style="width:${(i / dates.length) * 100}%"></i></div>`;
    let analysis = null;
    while (!analysis && !stop) {
      m.setBody(`${progress}<div class="note"><span class="spinner"></span> 正在分析 <b>${date}</b>（${i + 1}/${dates.length}）…</div>`);
      m.setFoot(autoBox() + `<button class="btn" data-act="stop">停止</button>`, tokenNote());
      try {
        ctrl = new AbortController();
        analysis = await analyzeDay(s, date, ctrl.signal);
      } catch (e) {
        if (stop) break;
        m.setBody(`${progress}<div class="error">${esc(date)} 分析失败：${esc((e as Error).message)}</div>`);
        m.setFoot(`<button class="btn" data-act="stop">停止</button><button class="btn" data-act="skip">跳过这天</button><button class="btn primary" data-act="retry">重试</button>`);
        const act = await waitAct();
        if (act === "skip") {
          skipped++;
          break;
        }
      }
    }
    if (!analysis || stop) continue;

    if (auto) {
      applyAnalysis(analysis);
      merged++;
      onChange?.();
      continue;
    }
    current = { date, s: toReviewState(analysis) };
    renderReview(m, date, current.s);
    m.setFoot(
      autoBox() +
        `<button class="btn" data-act="stop">停止</button><button class="btn" data-act="skip">跳过这天</button>
        <button class="btn primary" data-act="merge">${i < dates.length - 1 ? "合并，继续下一天 →" : "合并"}</button>`,
      tokenNote(),
    );
    const act = await waitAct();
    if (act === "merge") {
      applyAnalysis(fromReviewState(date, current.s));
      merged++;
      onChange?.();
    } else if (act === "skip") skipped++;
    current = null;
    m.body.scrollTop = 0;
  }

  running = false;
  if (document.body.contains(m.el)) {
    const left = dates.length - merged - skipped;
    m.setBody(
      `<div class="success">已合并 ${merged} 天${skipped ? `，跳过 ${skipped} 天` : ""}${left > 0 ? `，还有 ${left} 天未处理` : ""}。</div>`,
    );
    m.setFoot(`<button class="btn primary" data-act="close">完成</button>`, tokenNote());
    await waitAct();
    m.close();
  } else if (merged) toast(`已合并 ${merged} 天`);
}

export const isRunning = () => running;
