/**
 * Model calls the harness makes when a task needs a model: a script from a
 * brief, an image from a prompt. Azure first (the account has credits and the
 * OpenAI-compatible /openai/v1 base takes any deployed model by deployment
 * name), OpenRouter or OpenAI as fallbacks for chat, Gemini for anything that
 * has to watch video (mh judge). Keys never leave the environment.
 */
export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type ChatProvider = { name: string; base: string; headers: Record<string, string>; model: string };

/** the first configured chat provider: MH_CHAT_* overrides, then Azure, OpenRouter, OpenAI */
export const chatProvider = (model?: string): ChatProvider => {
  const env = process.env;
  if (env.MH_CHAT_BASE && env.MH_CHAT_KEY) return { name: "custom", base: env.MH_CHAT_BASE.replace(/\/$/, ""), headers: { authorization: `Bearer ${env.MH_CHAT_KEY}`, "api-key": env.MH_CHAT_KEY }, model: model ?? env.MH_CHAT_MODEL ?? "gpt-4o" };
  if (env.AZURE_OPENAI_ENDPOINT && env.AZURE_OPENAI_API_KEY) {
    const base = env.AZURE_OPENAI_ENDPOINT.replace(/\/$/, "");
    return { name: "azure", base: base.endsWith("/openai/v1") ? base : `${base}/openai/v1`, headers: { authorization: `Bearer ${env.AZURE_OPENAI_API_KEY}`, "api-key": env.AZURE_OPENAI_API_KEY }, model: model ?? env.AZURE_CHAT_DEPLOYMENT ?? env.MH_CHAT_MODEL ?? "DeepSeek-V4-Pro" };
  }
  if (env.OPENROUTER_API_KEY) return { name: "openrouter", base: "https://openrouter.ai/api/v1", headers: { authorization: `Bearer ${env.OPENROUTER_API_KEY}` }, model: model ?? env.MH_CHAT_MODEL ?? "deepseek/deepseek-v4-pro" };
  if (env.OPENAI_API_KEY) return { name: "openai", base: "https://api.openai.com/v1", headers: { authorization: `Bearer ${env.OPENAI_API_KEY}` }, model: model ?? env.MH_CHAT_MODEL ?? "gpt-4o" };
  throw new Error("no chat provider: set AZURE_OPENAI_ENDPOINT + AZURE_OPENAI_API_KEY (deployment via AZURE_CHAT_DEPLOYMENT), or OPENROUTER_API_KEY, or OPENAI_API_KEY, or MH_CHAT_BASE + MH_CHAT_KEY");
};

/** one chat completion; `json` asks for a JSON object and parses it */
export const chat = async (messages: ChatMessage[], opts: { model?: string; json?: boolean; maxTokens?: number; temperature?: number } = {}): Promise<{ text: string; provider: string; model: string; ms: number }> => {
  const p = chatProvider(opts.model);
  const t0 = performance.now();
  const r = await fetch(`${p.base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...p.headers },
    body: JSON.stringify({ model: p.model, messages, max_tokens: opts.maxTokens ?? 4000, temperature: opts.temperature ?? 0.4, ...(opts.json ? { response_format: { type: "json_object" } } : {}) }),
  });
  if (!r.ok) throw new Error(`${p.name} ${p.model}: ${r.status} ${(await r.text()).slice(0, 300)}`);
  const j = (await r.json()) as { choices?: { message?: { content?: string } }[] };
  const text = j.choices?.[0]?.message?.content ?? "";
  return { text, provider: p.name, model: p.model, ms: Math.round(performance.now() - t0) };
};

export const chatJson = async <T,>(messages: ChatMessage[], opts: { model?: string; maxTokens?: number } = {}): Promise<{ data: T; provider: string; model: string; ms: number }> => {
  const r = await chat(messages, { ...opts, json: true, temperature: 0.2 });
  const text = r.text.replace(/^```json\s*|```\s*$/g, "").trim();
  try {
    return { data: JSON.parse(text) as T, provider: r.provider, model: r.model, ms: r.ms };
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error(`${r.provider} ${r.model} did not return JSON: ${text.slice(0, 200)}`);
    return { data: JSON.parse(m[0]) as T, provider: r.provider, model: r.model, ms: r.ms };
  }
};

/* ---------- images ---------- */

export type ImageProvider = "azure-mai" | "azure-flux" | "openai";

export type ImageResult = { png: Buffer; provider: string; model: string; ms: number; width?: number; height?: number };

/**
 * One image from a prompt. Azure Foundry's MAI-Image (best text fidelity of the field, always
 * 1024x1024), FLUX.2 when deployed (honours width and height), OpenAI gpt-image as fallback.
 * The caller crops or extends to the format it needs.
 */
export const generateImage = async (prompt: string, opts: { provider?: ImageProvider; width?: number; height?: number; model?: string } = {}): Promise<ImageResult> => {
  const env = process.env;
  const provider: ImageProvider = opts.provider ?? (env.AZURE_IMAGE_ENDPOINT && env.AZURE_IMAGE_KEY ? "azure-mai" : env.OPENAI_API_KEY ? "openai" : (() => { throw new Error("no image provider: set AZURE_IMAGE_ENDPOINT + AZURE_IMAGE_KEY or OPENAI_API_KEY"); })());
  const t0 = performance.now();
  if (provider === "azure-mai" || provider === "azure-flux") {
    const base = env.AZURE_IMAGE_ENDPOINT!.replace(/\/$/, "");
    const headers = { "content-type": "application/json", authorization: `Bearer ${env.AZURE_IMAGE_KEY}` };
    if (provider === "azure-flux") {
      const model = opts.model ?? "flux-2-flex";
      const r = await fetch(`${base}/providers/blackforestlabs/v1/${model}?api-version=preview`, { method: "POST", headers, body: JSON.stringify({ model, prompt, width: opts.width ?? 1024, height: opts.height ?? 1024, output_format: "png", num_images: 1 }) });
      if (!r.ok) throw new Error(`azure flux ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const j = (await r.json()) as { data: { b64_json: string }[] };
      return { png: Buffer.from(j.data[0].b64_json, "base64"), provider, model, ms: Math.round(performance.now() - t0), width: opts.width, height: opts.height };
    }
    const model = opts.model ?? "MAI-Image-2.5-Pro";
    const r = await fetch(`${base}/mai/v1/images/generations`, { method: "POST", headers, body: JSON.stringify({ model, prompt, size: "1024x1024", n: 1 }) });
    if (!r.ok) throw new Error(`azure mai ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = (await r.json()) as { data: { b64_json: string }[] };
    return { png: Buffer.from(j.data[0].b64_json, "base64"), provider, model, ms: Math.round(performance.now() - t0), width: 1024, height: 1024 };
  }
  const model = opts.model ?? "gpt-image-1";
  const r = await fetch("https://api.openai.com/v1/images/generations", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: JSON.stringify({ model, prompt, size: opts.width && opts.height && opts.width > opts.height ? "1536x1024" : opts.width && opts.height && opts.width < opts.height ? "1024x1536" : "1024x1024", n: 1 }) });
  if (!r.ok) throw new Error(`openai images ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { data: { b64_json: string }[] };
  return { png: Buffer.from(j.data[0].b64_json, "base64"), provider, model, ms: Math.round(performance.now() - t0) };
};
