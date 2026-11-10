/** 日记列表：查看导入状态，单篇重新分析或删除 */
import { deleteEntry, getProject, isAnalyzed, isReadOnly } from "../store";
import { esc, weekdayName } from "../util";
import { confirmDialog } from "../ui/modal";
import { runAnalysis } from "../ui/flow";
import { openPanel } from "./detail";

export function mountEntries(root: HTMLElement) {
  const p = getProject();
  const ro = isReadOnly();
  if (!p.entries.length) {
    root.innerHTML = `<div class="empty-state"><h2>还没有日记</h2><p>点右上角「导入」上传 .md / .txt 文件，或直接粘贴正文。</p></div>`;
    return;
  }
  const pending = p.entries.filter((e) => !isAnalyzed(e.date)).length;
  root.innerHTML = `<div class="page">
    <h2>日记</h2><div class="sub">共 ${p.entries.length} 篇 · 已分析 ${p.entries.length - pending} · 待分析 ${pending}</div>
    <div class="card entries">
    ${[...p.entries]
      .reverse()
      .map((e) => {
        const ok = isAnalyzed(e.date);
        return `<div class="erow">
          <a href="javascript:void 0" data-view="${e.date}">${e.date} ${weekdayName(e.date)}</a>
          <span class="t">${e.label ? `<b>${esc(e.label)}</b> ` : ""}${esc(p.days[e.date]?.summary ?? e.paras[0] ?? "")}</span>
          <span class="status ${ok ? "ok" : "pending"}">${ok ? "已分析" : "待分析"} · ${e.paras.length} 段</span>
          ${ro ? "<span></span>" : `<span><button class="btn sm" data-re="${e.date}" ${p.categoriesLocked ? "" : "disabled title='请先确认分类'"}>${ok ? "重新分析" : "分析"}</button>
            <button class="btn sm ghost danger" data-del="${e.date}">删除</button></span>`}
        </div>`;
      })
      .join("")}
    </div>
    ${ro ? "" : `<div class="hint">重新分析某一天会先撤掉这一天原有的归类，再按当前的任务列表重新归类。</div>`}
  </div>`;

  root.querySelector(".page")!.addEventListener("click", async (ev) => {
    const t = ev.target as HTMLElement;
    const v = t.closest<HTMLElement>("[data-view]")?.dataset.view;
    if (v) openPanel({ type: "day", date: v });
    const re = t.closest<HTMLElement>("[data-re]")?.dataset.re;
    if (re) runAnalysis([re]);
    const del = t.closest<HTMLElement>("[data-del]")?.dataset.del;
    if (del && (await confirmDialog("删除日记", `删除 ${del} 的日记及其分析结果？此操作不可撤销（除非你有导出的备份）。`, "删除", true))) deleteEntry(del);
  });
}
