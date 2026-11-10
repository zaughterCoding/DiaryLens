import { proposeCategories } from "../analyze";
import { loadSettings } from "../llm";
import { getProject, nextColor, setCategories } from "../store";
import type { Category } from "../types";
import { esc, uid } from "../util";
import { openModal, toast } from "./modal";

/** 分类确认 / 编辑。首次使用时先请 AI 提议，再由用户增删改后锁定 */
export function openCategories(onDone?: () => void) {
  const p = getProject();
  let cats: Category[] = structuredClone(p.categories);
  let busy = false;
  let error = "";
  let ctrl: AbortController | null = null;
  const used = (id: string) => p.tasks.some((t) => t.cat === id) || p.daily.some((d) => d.cat === id);

  const m = openModal({
    title: p.categoriesLocked ? "编辑分类" : "确认分类",
    body: "",
    wide: true,
    onClose: () => {
      ctrl?.abort();
    },
  });

  const render = () => {
    if (busy) {
      m.setBody(`<div class="note"><span class="spinner"></span> 正在让模型阅读 ${p.entries.length} 篇日记并提议分类，通常需要 10–60 秒…</div>`);
      m.setFoot(`<button class="btn" data-act="cancel">取消</button>`);
      return;
    }
    const intro = p.categoriesLocked
      ? `可以改名、改颜色、改说明。已被任务或每日格使用的大类不能删除，也不能切换展示方式。`
      : `下面是 AI 根据日记提议的大类。<b>横条</b>用于跨天推进的事（项目、学习主题），<b>每日格</b>用于每天重复的习惯（运动、饮食），每日格的「类型」会在格子上用不同深浅区分。确认后，之后每篇日记都会按这套分类归档。`;
    m.setBody(
      `<div class="note">${intro}</div>${error ? `<div class="error">${esc(error)}</div>` : ""}
      <div class="cat-edit head"><span>颜色</span><span>名称</span><span>展示方式</span><span>归类说明</span><span></span></div>
      ${cats
        .map(
          (c, i) => `<div class="cat-edit" data-i="${i}">
          <input type="color" data-f="color" value="${c.color}">
          <input type="text" data-f="name" value="${esc(c.name)}" placeholder="名称">
          <select data-f="mode" ${used(c.id) ? "disabled" : ""}><option value="bars" ${c.mode === "bars" ? "selected" : ""}>横条</option><option value="daily" ${c.mode === "daily" ? "selected" : ""}>每日格</option></select>
          <input type="text" class="desc" data-f="desc" value="${esc(c.desc ?? "")}" placeholder="什么内容归入这里">
          <button class="del" data-del="${i}" title="${used(c.id) ? "已被使用，不能删除" : "删除"}" ${used(c.id) ? "disabled" : ""}>×</button>
          ${
            c.mode === "daily"
              ? `<div class="tags">类型：${(c.tags ?? [])
                  .map((t, j) => `<input type="text" data-tag="${j}" value="${esc(t.name)}">`)
                  .join("")}<button class="btn sm ghost" data-addtag="${i}">＋</button>${(c.tags?.length ?? 0) > 1 ? `<button class="btn sm ghost" data-deltag="${i}">－</button>` : ""}</div>`
              : ""
          }
        </div>`,
        )
        .join("")}
      <button class="btn sm" data-act="add" style="margin-top:10px">＋ 添加大类</button>`,
    );
    m.setFoot(
      `${p.entries.length ? `<button class="btn" data-act="propose">${cats.length ? "重新提议" : "让 AI 提议"}</button>` : ""}
       <button class="btn primary" data-act="save" ${cats.length ? "" : "disabled"}>${p.categoriesLocked ? "保存" : "确认分类"}</button>`,
      `${cats.length} 个大类`,
    );
  };

  const propose = async () => {
    busy = true;
    error = "";
    ctrl = new AbortController();
    render();
    try {
      const proposed = await proposeCategories(loadSettings(), ctrl.signal);
      // 保留已被使用的大类，避免丢数据
      const keep = cats.filter((c) => used(c.id));
      cats = [...keep, ...proposed.filter((c) => !keep.some((k) => k.id === c.id))];
    } catch (e) {
      if (!ctrl.signal.aborted) error = (e as Error).message;
    }
    busy = false;
    ctrl = null;
    if (document.body.contains(m.el)) render();
  };

  m.body.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement;
    const row = t.closest<HTMLElement>(".cat-edit[data-i]");
    if (!row) return;
    const c = cats[+row.dataset.i!];
    if (t.dataset.f === "name") c.name = t.value;
    if (t.dataset.f === "desc") c.desc = t.value;
    if (t.dataset.f === "color") c.color = t.value;
    if (t.dataset.tag) c.tags![+t.dataset.tag].name = t.value;
  });
  m.body.addEventListener("change", (e) => {
    const t = e.target as HTMLSelectElement;
    const row = t.closest<HTMLElement>(".cat-edit[data-i]");
    if (row && t.dataset.f === "mode") {
      const c = cats[+row.dataset.i!];
      c.mode = t.value as Category["mode"];
      if (c.mode === "daily" && !c.tags?.length) c.tags = [{ id: "done", name: "有记录" }, { id: "rest", name: "休息" }];
      render();
    }
  });
  m.body.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const del = t.closest<HTMLElement>("[data-del]");
    if (del) {
      cats.splice(+del.dataset.del!, 1);
      render();
    }
    const addTag = t.closest<HTMLElement>("[data-addtag]");
    if (addTag) {
      const c = cats[+addTag.dataset.addtag!];
      c.tags = [...(c.tags ?? []), { id: uid("tag"), name: "新类型" }];
      render();
    }
    const delTag = t.closest<HTMLElement>("[data-deltag]");
    if (delTag) {
      const c = cats[+delTag.dataset.deltag!];
      const removed = c.tags!.at(-1)!;
      if (p.daily.some((d) => d.cat === c.id && d.tag === removed.id)) return toast("这个类型已被使用，不能删除", true);
      c.tags = c.tags!.slice(0, -1);
      render();
    }
    if (t.closest("[data-act=add]")) {
      cats.push({ id: uid("c"), name: "新大类", mode: "bars", color: nextColor(cats.map((c) => c.color)) });
      render();
    }
  });
  m.foot.addEventListener("click", (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>("[data-act]")?.dataset.act;
    if (act === "cancel") ctrl?.abort();
    if (act === "propose") propose();
    if (act === "save") {
      const bad = cats.find((c) => !c.name.trim());
      if (bad) return toast("大类名称不能为空", true);
      cats.forEach((c) => (c.name = c.name.trim()));
      setCategories(cats, true);
      m.close();
      toast("分类已确认");
      onDone?.();
    }
  });

  if (!cats.length && p.entries.length) propose();
  else render();
}
