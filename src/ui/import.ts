import { parseDiary, parsePasted, type ParsedFile } from "../parse";
import { entryOf, isAnalyzed, upsertEntries } from "../store";
import { esc, toDateStr } from "../util";
import { openModal, toast } from "./modal";

const FROM_LABEL: Record<ParsedFile["dateFrom"], string> = {
  meta: "正文元数据",
  filename: "文件名",
  content: "正文开头",
  manual: "手动指定",
  none: "未识别",
};

export function openImport(onDone?: () => void) {
  let mode: "files" | "paste" = "files";
  let parsed: ParsedFile[] = [];
  const m = openModal({ title: "导入日记", body: "", wide: true });

  const render = () => {
    const tabs = `<div class="seg-tabs">
      <button data-mode="files" class="${mode === "files" ? "on" : ""}">上传文件</button>
      <button data-mode="paste" class="${mode === "paste" ? "on" : ""}">粘贴正文</button></div>`;
    if (mode === "files") {
      m.setBody(
        tabs +
          `<label class="drop" id="drop">
            <input type="file" id="file" multiple accept=".md,.markdown,.txt,text/plain,text/markdown" hidden>
            <div style="font-size:15px;margin-bottom:4px">点击选择或把文件拖到这里</div>
            <div class="hint">支持 .md / .txt，可多选；一个文件 = 一天。日期按「正文里的 日期：… 」→ 文件名 → 正文开头 的顺序识别。</div>
          </label>` +
          (parsed.length ? tableHTML() : ""),
      );
      const n = parsed.filter((p) => p.entry.date).length;
      m.setFoot(
        parsed.length ? `<button class="btn" data-act="clear">清空</button><button class="btn primary" data-act="import" ${n ? "" : "disabled"}>导入 ${n} 篇</button>` : "",
        parsed.length ? `已选 ${parsed.length} 个文件` : "",
      );
    } else {
      m.setBody(
        tabs +
          `<label class="field"><span>日期</span><input type="date" id="pdate" value="${toDateStr(new Date())}" style="width:180px"></label>
          <label class="field"><span>正文 <small>每个非空行会成为一个段落</small></span><textarea id="ptext" rows="14" placeholder="把当天的日记粘贴到这里"></textarea></label>
          <div id="pwarn"></div>`,
      );
      m.setFoot(`<button class="btn primary" data-act="paste">导入这一天</button>`);
    }
  };

  const tableHTML = () => `<table class="tbl"><thead><tr><th>文件</th><th>日期</th><th>来源</th><th>段落</th><th>开头</th></tr></thead><tbody>
    ${parsed
      .map((p, i) => {
        const e = p.entry;
        const exist = e.date && entryOf(e.date);
        const dup = e.date && parsed.findIndex((x) => x.entry.date === e.date) !== i;
        return `<tr>
        <td>${esc(e.source)}</td>
        <td><input type="date" data-i="${i}" value="${e.date}"></td>
        <td class="${p.dateFrom === "none" ? "warn" : "muted"}">${FROM_LABEL[p.dateFrom]}${exist ? `<div class="warn">将覆盖已有日记${isAnalyzed(e.date) ? "及其分析" : ""}</div>` : ""}${dup ? `<div class="warn">与上面的文件日期重复</div>` : ""}</td>
        <td>${e.paras.length}</td>
        <td class="wrap">${esc(e.paras[0] ?? "")}</td></tr>`;
      })
      .join("")}</tbody></table>`;

  const addFiles = async (files: FileList | File[]) => {
    for (const f of [...files]) {
      if (!/\.(md|markdown|txt)$/i.test(f.name) && !f.type.startsWith("text/")) continue;
      parsed.push(parseDiary(await f.text(), f.name));
    }
    parsed.sort((a, b) => (a.entry.date || "9").localeCompare(b.entry.date || "9") || (a.entry.source ?? "").localeCompare(b.entry.source ?? ""));
    render();
  };

  m.body.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-mode]");
    if (b) {
      mode = b.dataset.mode as typeof mode;
      render();
    }
  });
  m.body.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id === "file" && t.files) addFiles(t.files);
    if (t.dataset.i) {
      parsed[+t.dataset.i].entry.date = t.value;
      parsed[+t.dataset.i].dateFrom = t.value ? "manual" : "none";
      render();
    }
  });
  m.body.addEventListener("dragover", (e) => {
    e.preventDefault();
    m.body.querySelector("#drop")?.classList.add("over");
  });
  m.body.addEventListener("dragleave", () => m.body.querySelector("#drop")?.classList.remove("over"));
  m.body.addEventListener("drop", (e) => {
    e.preventDefault();
    m.body.querySelector("#drop")?.classList.remove("over");
    if (e.dataTransfer?.files) addFiles(e.dataTransfer.files);
  });

  m.foot.addEventListener("click", (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>("[data-act]")?.dataset.act;
    if (act === "clear") {
      parsed = [];
      render();
    } else if (act === "import") {
      // 同一日期出现多次时，后面的覆盖前面的
      const list = parsed.filter((p) => p.entry.date && p.entry.paras.length).map((p) => p.entry);
      const skipped = parsed.length - list.length;
      upsertEntries(list);
      m.close();
      toast(`已导入 ${list.length} 篇${skipped ? `，跳过 ${skipped} 个（无日期或无正文）` : ""}`);
      onDone?.();
    } else if (act === "paste") {
      const date = (m.body.querySelector("#pdate") as HTMLInputElement).value;
      const text = (m.body.querySelector("#ptext") as HTMLTextAreaElement).value;
      const warn = m.body.querySelector("#pwarn")!;
      if (!date || !text.trim()) {
        warn.innerHTML = `<div class="error">请填写日期和正文</div>`;
        return;
      }
      const entry = parsePasted(text, date);
      if (!entry.paras.length) {
        warn.innerHTML = `<div class="error">没有识别到正文段落</div>`;
        return;
      }
      upsertEntries([entry]);
      m.close();
      toast(`已导入 ${date}（${entry.paras.length} 段）`);
      onDone?.();
    }
  });

  render();
}
