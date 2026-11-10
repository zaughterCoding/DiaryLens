import { esc } from "../util";

export interface ModalOpts {
  title: string;
  body: string;
  wide?: boolean;
  /** 底部左侧的说明文字 */
  footNote?: string;
  /** 底部按钮 html（自行用 data-act 标识） */
  foot?: string;
  /** 点遮罩或 × 时调用；返回 false 阻止关闭 */
  onClose?: () => boolean | void;
}

export interface ModalHandle {
  el: HTMLElement;
  body: HTMLElement;
  foot: HTMLElement;
  close: () => void;
  setBody: (html: string) => void;
  setFoot: (html: string, note?: string) => void;
}

export function openModal(o: ModalOpts): ModalHandle {
  const mask = document.createElement("div");
  mask.className = "modal-mask";
  mask.innerHTML = `<div class="modal ${o.wide ? "wide" : ""}" role="dialog" aria-modal="true">
    <div class="mh"><h3>${esc(o.title)}</h3><button class="x" title="关闭">×</button></div>
    <div class="mb"></div>
    <div class="mf"></div>
  </div>`;
  document.body.appendChild(mask);
  const el = mask.querySelector<HTMLElement>(".modal")!;
  const body = el.querySelector<HTMLElement>(".mb")!;
  const foot = el.querySelector<HTMLElement>(".mf")!;
  const close = () => {
    mask.remove();
    document.removeEventListener("keydown", onKey);
  };
  const tryClose = () => {
    if (o.onClose?.() === false) return;
    close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && document.body.lastElementChild === mask) tryClose();
  };
  document.addEventListener("keydown", onKey);
  el.querySelector(".x")!.addEventListener("click", tryClose);
  mask.addEventListener("mousedown", (e) => {
    if (e.target === mask) tryClose();
  });
  const h: ModalHandle = {
    el,
    body,
    foot,
    close,
    setBody: (html) => (body.innerHTML = html),
    setFoot: (html, note) => {
      foot.innerHTML = (note ? `<span class="left">${note}</span>` : "") + html;
      foot.style.display = html || note ? "" : "none";
    },
  };
  h.setBody(o.body);
  h.setFoot(o.foot ?? "", o.footNote);
  return h;
}

export function confirmDialog(title: string, message: string, okText = "确定", danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const m = openModal({
      title,
      body: `<div style="line-height:1.8">${message}</div>`,
      foot: `<button class="btn" data-act="no">取消</button><button class="btn ${danger ? "danger" : "primary"}" data-act="ok">${esc(okText)}</button>`,
      onClose: () => {
        if (!done) resolve(false);
      },
    });
    m.foot.addEventListener("click", (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>("[data-act]")?.dataset.act;
      if (!act) return;
      done = true;
      m.close();
      resolve(act === "ok");
    });
  });
}

export function toast(msg: string, err = false, ms = 3200) {
  let box = document.getElementById("toasts");
  if (!box) {
    box = document.createElement("div");
    box.id = "toasts";
    document.body.appendChild(box);
  }
  const t = document.createElement("div");
  t.className = "toast" + (err ? " err" : "");
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

/* ───── 悬浮提示（全局共用一个） ───── */
let tipEl: HTMLElement | null = null;
export function showTip(html: string, e: MouseEvent) {
  if (!tipEl) {
    tipEl = document.createElement("div");
    tipEl.id = "tip";
    document.body.appendChild(tipEl);
  }
  tipEl.innerHTML = html;
  tipEl.classList.add("on");
  const r = tipEl.getBoundingClientRect();
  let x = e.clientX + 14, y = e.clientY + 14;
  if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
  if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 14;
  tipEl.style.left = x + "px";
  tipEl.style.top = y + "px";
}
export const hideTip = () => tipEl?.classList.remove("on");
