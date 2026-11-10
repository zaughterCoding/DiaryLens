/** OpenAI 兼容的 Chat Completions 客户端，浏览器直连，key 只存在本地 */

export interface LLMSettings {
  preset: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  /** 是否发送 response_format: json_object（部分服务商不支持） */
  jsonMode: boolean;
  temperature: number;
  /** false 时 key 只存在 sessionStorage，关掉页面即清除 */
  rememberKey: boolean;
}

export interface Preset {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  jsonMode: boolean;
  note?: string;
}

export const PRESETS: Preset[] = [
  { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com", model: "deepseek-flash", jsonMode: true },
  { id: "moonshot", name: "Kimi (Moonshot)", baseUrl: "https://api.moonshot.cn/v1", model: "moonshot-v1-32k", jsonMode: true },
  { id: "qwen", name: "通义千问 (DashScope)", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus", jsonMode: true },
  { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", jsonMode: true },
  { id: "custom", name: "自定义（OpenAI 兼容）", baseUrl: "", model: "", jsonMode: false },
  {
    id: "mock",
    name: "演示模式（不调用 AI）",
    baseUrl: "mock://",
    model: "mock",
    jsonMode: true,
    note: "用关键词规则模拟分析结果，只用来体验界面，结果很粗糙。",
  },
];

const LS_KEY = "diarylens.llm";
const SS_KEY = "diarylens.apikey";

export function loadSettings(): LLMSettings {
  const def: LLMSettings = { ...presetFields("deepseek"), apiKey: "", temperature: 0.3, rememberKey: true };
  try {
    const s = { ...def, ...JSON.parse(localStorage.getItem(LS_KEY) || "{}") } as LLMSettings;
    if (!s.rememberKey) s.apiKey = sessionStorage.getItem(SS_KEY) || "";
    // 旧版本的 DeepSeek 默认模型名，迁移到当前默认
    if (s.preset === "deepseek" && s.model === "deepseek-chat") s.model = presetFields("deepseek").model;
    return s;
  } catch {
    return def;
  }
}

export function saveSettings(s: LLMSettings) {
  try {
    const persisted = { ...s, apiKey: s.rememberKey ? s.apiKey : "" };
    localStorage.setItem(LS_KEY, JSON.stringify(persisted));
    if (s.rememberKey) sessionStorage.removeItem(SS_KEY);
    else sessionStorage.setItem(SS_KEY, s.apiKey);
  } catch {
    /* 隐私模式下存储不可用，忽略 */
  }
}

export function presetFields(id: string) {
  const p = PRESETS.find((x) => x.id === id) ?? PRESETS[0];
  return { preset: p.id, baseUrl: p.baseUrl, model: p.model, jsonMode: p.jsonMode };
}

export const isMock = (s: LLMSettings) => s.baseUrl.startsWith("mock://");

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** 累计 token 用量，显示在状态栏 */
export const usage = { prompt: 0, completion: 0, calls: 0 };

const endpoint = (base: string, path: string) => base.replace(/\/+$/, "") + path;

export class LLMError extends Error {}

export async function chat(s: LLMSettings, messages: ChatMessage[], signal?: AbortSignal): Promise<string> {
  if (!s.baseUrl || !s.model) throw new LLMError("请先在「模型设置」里填写接口地址和模型名");
  if (!s.apiKey) throw new LLMError("请先在「模型设置」里填写 API Key");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 180_000);
  signal?.addEventListener("abort", () => ctrl.abort());
  let res: Response;
  try {
    res = await fetch(endpoint(s.baseUrl, "/chat/completions"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.apiKey}` },
      body: JSON.stringify({
        model: s.model,
        messages,
        temperature: s.temperature,
        ...(s.jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: ctrl.signal,
    });
  } catch (e) {
    if (signal?.aborted) throw new LLMError("已取消");
    if (ctrl.signal.aborted) throw new LLMError("请求超时（180 秒）");
    throw new LLMError(
      `网络请求失败：${(e as Error).message}。如果地址无误，可能是该服务商不允许浏览器直接调用（CORS），请换服务商或使用本地代理。`,
    );
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      msg = JSON.parse(text).error?.message ?? text;
    } catch {
      /* 非 JSON 错误体 */
    }
    throw new LLMError(`接口返回 ${res.status}：${msg.slice(0, 300)}`);
  }
  const data = JSON.parse(text);
  usage.calls++;
  usage.prompt += data.usage?.prompt_tokens ?? 0;
  usage.completion += data.usage?.completion_tokens ?? 0;
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new LLMError("接口返回里没有 message.content");
  return content;
}

/** 从模型输出中提取 JSON：容忍 ```json 包裹和前后多余文字 */
export function extractJSON(text: string): any {
  const t = text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf("{"), b = t.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw new LLMError("模型输出不是 JSON");
  }
}

/** 调用并解析 JSON，解析失败时让模型重试一次 */
export async function chatJSON(s: LLMSettings, messages: ChatMessage[], signal?: AbortSignal): Promise<any> {
  const first = await chat(s, messages, signal);
  try {
    return extractJSON(first);
  } catch {
    const retry = await chat(
      s,
      [...messages, { role: "assistant", content: first }, { role: "user", content: "上面的输出无法解析为 JSON。请只输出一个合法的 JSON 对象，不要任何解释或代码块标记。" }],
      signal,
    );
    return extractJSON(retry);
  }
}

/** 测试连接：拉取模型列表（拿不到就发一条极短的对话） */
export async function testConnection(s: LLMSettings): Promise<string> {
  try {
    const res = await fetch(endpoint(s.baseUrl, "/models"), { headers: { Authorization: `Bearer ${s.apiKey}` } });
    if (res.ok) {
      const data = await res.json();
      const ids: string[] = (data.data ?? []).map((m: any) => m.id);
      if (ids.length) return `连接成功。可用模型：${ids.slice(0, 12).join("、")}${ids.length > 12 ? " 等" : ""}`;
    }
  } catch {
    /* 有的服务商不开放 /models，退回到对话测试 */
  }
  const out = await chat({ ...s, jsonMode: false }, [{ role: "user", content: "回复两个字：你好" }]);
  return `连接成功，模型回复：${out.slice(0, 40)}`;
}
