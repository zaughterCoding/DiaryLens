import { loadSettings, PRESETS, presetFields, saveSettings, testConnection, type LLMSettings } from "../llm";
import { esc } from "../util";
import { openModal, toast } from "./modal";

export function openSettings(onSaved?: () => void) {
  let s: LLMSettings = loadSettings();
  const m = openModal({
    title: "模型设置",
    body: "",
    foot: `<button class="btn" data-act="test">测试连接</button><button class="btn primary" data-act="save">保存</button>`,
  });

  const render = () => {
    const preset = PRESETS.find((p) => p.id === s.preset);
    const mock = s.preset === "mock";
    m.setBody(`
      <label class="field"><span>服务商</span>
        <select name="preset">${PRESETS.map((p) => `<option value="${p.id}" ${p.id === s.preset ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>
      </label>
      ${preset?.note ? `<div class="note">${esc(preset.note)}</div>` : ""}
      ${mock ? "" : `
      <label class="field"><span>接口地址 Base URL <small>会请求 {Base URL}/chat/completions</small></span>
        <input type="url" name="baseUrl" value="${esc(s.baseUrl)}" placeholder="https://api.example.com/v1">
      </label>
      <label class="field"><span>模型名</span>
        <input type="text" name="model" value="${esc(s.model)}" placeholder="例如 deepseek-flash">
      </label>
      <label class="field"><span>API Key</span>
        <input type="password" name="apiKey" value="${esc(s.apiKey)}" autocomplete="off" placeholder="sk-...">
      </label>
      <label class="check" style="margin-bottom:8px"><input type="checkbox" name="rememberKey" ${s.rememberKey ? "checked" : ""}> 在本浏览器记住 Key（不勾选则关闭页面后清除）</label><br>
      <label class="check" style="margin-bottom:8px"><input type="checkbox" name="jsonMode" ${s.jsonMode ? "checked" : ""}> 使用 JSON 输出模式（response_format；服务商报错时关掉）</label>
      <label class="field" style="margin-top:8px"><span>Temperature <small>越低结果越稳定</small></span>
        <input type="number" name="temperature" min="0" max="1.5" step="0.1" value="${s.temperature}" style="width:100px">
      </label>
      <div class="note">Key 只保存在你的浏览器里，页面直接请求你填写的接口地址，不经过任何其他服务器。日记正文会发送给该服务商用于分析。</div>`}
      <div id="test-out"></div>`);
  };
  render();

  const read = () => {
    const f = (n: string) => m.body.querySelector<HTMLInputElement>(`[name=${n}]`);
    if (f("baseUrl")) s.baseUrl = f("baseUrl")!.value.trim();
    if (f("model")) s.model = f("model")!.value.trim();
    if (f("apiKey")) s.apiKey = f("apiKey")!.value.trim();
    if (f("rememberKey")) s.rememberKey = f("rememberKey")!.checked;
    if (f("jsonMode")) s.jsonMode = f("jsonMode")!.checked;
    if (f("temperature")) s.temperature = Math.max(0, Math.min(2, Number(f("temperature")!.value) || 0));
  };

  m.body.addEventListener("change", (e) => {
    const t = e.target as HTMLSelectElement;
    if (t.name === "preset") {
      read();
      s = { ...s, ...presetFields(t.value) };
      render();
    }
  });

  m.foot.addEventListener("click", async (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>("[data-act]")?.dataset.act;
    if (!act) return;
    read();
    if (act === "save") {
      saveSettings(s);
      m.close();
      toast("模型设置已保存");
      onSaved?.();
    } else if (act === "test") {
      const out = m.body.querySelector("#test-out")!;
      if (s.preset === "mock") {
        out.innerHTML = `<div class="success">演示模式无需连接。</div>`;
        return;
      }
      out.innerHTML = `<div class="note"><span class="spinner"></span> 正在连接…</div>`;
      try {
        out.innerHTML = `<div class="success">${esc(await testConnection(s))}</div>`;
      } catch (err) {
        out.innerHTML = `<div class="error">${esc((err as Error).message)}</div>`;
      }
    }
  });
}
