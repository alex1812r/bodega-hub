import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

import { createMockAssistantModel } from "./mockModel";

export const assistantProviders = ["anthropic", "google", "mock"] as const;

export type AssistantProvider = (typeof assistantProviders)[number];

/**
 * Se fija un modelo estable en vez de `gemini-flash-latest` (que hoy apunta a
 * un preview y ya devolvio "high demand"). El free tier de Gemini es de 20
 * peticiones al dia POR MODELO, asi que la eleccion no cambia la cuota: es por
 * estabilidad y costo. Para otro Flash, `ASSISTANT_MODEL`.
 */
const DEFAULT_GOOGLE_MODEL = "gemini-2.5-flash";
const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5";

export type AssistantModelInfo = {
  model: LanguageModel;
  modelId: string;
  provider: AssistantProvider;
};

let warned = false;

function warnOnce(message: string) {
  if (warned) {
    return;
  }

  warned = true;
  console.warn(`[assistant] ${message}`);
}

/** Solo para tests: permite volver a emitir el aviso de fallback. */
export function resetAssistantProviderWarning() {
  warned = false;
}

function readProvider(): AssistantProvider {
  const configured = process.env.ASSISTANT_PROVIDER?.trim().toLowerCase();

  if (configured && (assistantProviders as readonly string[]).includes(configured)) {
    return configured as AssistantProvider;
  }

  if (configured) {
    warnOnce(`ASSISTANT_PROVIDER="${configured}" no es valido; se usa el default.`);
  }

  return "google";
}

function readKey(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

/**
 * Resuelve el modelo por variables de entorno. Sin key utilizable cae a `mock`
 * para que la app siga respondiendo (con datos reales, redaccion determinista).
 */
export function createAssistantModel(): AssistantModelInfo {
  const provider = readProvider();
  const modelOverride = process.env.ASSISTANT_MODEL?.trim() || null;

  if (provider === "mock") {
    return { model: createMockAssistantModel(), modelId: "assistant-mock", provider: "mock" };
  }

  const googleKey = readKey("GOOGLE_GENERATIVE_AI_API_KEY");
  const anthropicKey = readKey("ANTHROPIC_API_KEY");

  if (provider === "google" && googleKey) {
    const modelId = modelOverride ?? DEFAULT_GOOGLE_MODEL;
    return {
      model: createGoogleGenerativeAI({ apiKey: googleKey })(modelId),
      modelId,
      provider: "google",
    };
  }

  if (provider === "anthropic" && anthropicKey) {
    const modelId = modelOverride ?? DEFAULT_ANTHROPIC_MODEL;
    return {
      model: createAnthropic({ apiKey: anthropicKey })(modelId),
      modelId,
      provider: "anthropic",
    };
  }

  // Proveedor pedido sin key: intentamos el otro antes de degradar a mock.
  if (googleKey) {
    warnOnce(`Sin key para "${provider}"; se usa Google.`);
    const modelId = DEFAULT_GOOGLE_MODEL;
    return {
      model: createGoogleGenerativeAI({ apiKey: googleKey })(modelId),
      modelId,
      provider: "google",
    };
  }

  if (anthropicKey) {
    warnOnce(`Sin key para "${provider}"; se usa Anthropic.`);
    const modelId = DEFAULT_ANTHROPIC_MODEL;
    return {
      model: createAnthropic({ apiKey: anthropicKey })(modelId),
      modelId,
      provider: "anthropic",
    };
  }

  warnOnce(
    "No hay GOOGLE_GENERATIVE_AI_API_KEY ni ANTHROPIC_API_KEY; el asistente responde con el proveedor mock.",
  );

  return { model: createMockAssistantModel(), modelId: "assistant-mock", provider: "mock" };
}
