import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

import { createMockAssistantModel } from "./mockModel";

export const modelProviders = ["anthropic", "google", "mock"] as const;

export type ModelProvider = (typeof modelProviders)[number];


/**
 * Se fija un modelo estable en vez de `gemini-flash-latest` (que hoy apunta a
 * un preview y ya devolvio "high demand"). El free tier de Gemini es de 20
 * peticiones al dia POR MODELO, asi que la eleccion no cambia la cuota: es por
 * estabilidad y costo. Para otro Flash, `ASSISTANT_MODEL`.
 */
const DEFAULT_GOOGLE_MODEL = "gemini-2.5-flash";
const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5";

export type ResolvedModelInfo = {
  model: LanguageModel;
  modelId: string;
  provider: ModelProvider;
};

export type AssistantModelInfo = ResolvedModelInfo;

export type ModelFromEnvConfig = {
  /** Variable con el proveedor pedido (`google|anthropic|mock`). */
  providerEnv: string;
  /** Variable con el id de modelo que reemplaza al default del proveedor pedido. */
  modelEnv: string;
  /** Prefijo de los avisos en consola, sin corchetes. */
  logPrefix: string;
  /** Aviso cuando no hay ninguna key y se degrada a mock. */
  noKeyMessage: string;
  mockModelId: string;
  createMock: () => LanguageModel;
};

/** Un aviso por prefijo: el asistente y el escaneo avisan cada uno una vez. */
const warnedPrefixes = new Set<string>();

function warnOnce(prefix: string, message: string) {
  if (warnedPrefixes.has(prefix)) {
    return;
  }

  warnedPrefixes.add(prefix);
  console.warn(`[${prefix}] ${message}`);
}

/** Solo para tests: permite volver a emitir el aviso de fallback de un prefijo. */
export function resetModelProviderWarning(prefix: string) {
  warnedPrefixes.delete(prefix);
}

/** Solo para tests: permite volver a emitir el aviso de fallback. */
export function resetAssistantProviderWarning() {
  resetModelProviderWarning("assistant");
}

function readProvider(config: ModelFromEnvConfig): ModelProvider {
  const configured = process.env[config.providerEnv]?.trim().toLowerCase();

  if (configured && (modelProviders as readonly string[]).includes(configured)) {
    return configured as ModelProvider;
  }

  if (configured) {
    warnOnce(
      config.logPrefix,
      `${config.providerEnv}="${configured}" no es valido; se usa el default.`,
    );
  }

  return "google";
}

function readKey(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

/**
 * Resuelve el modelo por variables de entorno. Sin key del proveedor pedido
 * prueba el otro, y sin ninguna key cae a `mock` para que la app siga
 * respondiendo. El override de modelo solo aplica al proveedor pedido.
 */
export function createModelFromEnv(config: ModelFromEnvConfig): ResolvedModelInfo {
  const provider = readProvider(config);
  const modelOverride = process.env[config.modelEnv]?.trim() || null;
  const mock = (): ResolvedModelInfo => ({
    model: config.createMock(),
    modelId: config.mockModelId,
    provider: "mock",
  });

  if (provider === "mock") {
    return mock();
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
    warnOnce(config.logPrefix, `Sin key para "${provider}"; se usa Google.`);
    const modelId = DEFAULT_GOOGLE_MODEL;
    return {
      model: createGoogleGenerativeAI({ apiKey: googleKey })(modelId),
      modelId,
      provider: "google",
    };
  }

  if (anthropicKey) {
    warnOnce(config.logPrefix, `Sin key para "${provider}"; se usa Anthropic.`);
    const modelId = DEFAULT_ANTHROPIC_MODEL;
    return {
      model: createAnthropic({ apiKey: anthropicKey })(modelId),
      modelId,
      provider: "anthropic",
    };
  }

  warnOnce(config.logPrefix, config.noKeyMessage);

  return mock();
}

export function createAssistantModel(): AssistantModelInfo {
  return createModelFromEnv({
    createMock: () => createMockAssistantModel(),
    logPrefix: "assistant",
    mockModelId: "assistant-mock",
    modelEnv: "ASSISTANT_MODEL",
    noKeyMessage:
      "No hay GOOGLE_GENERATIVE_AI_API_KEY ni ANTHROPIC_API_KEY; el asistente responde con el proveedor mock.",
    providerEnv: "ASSISTANT_PROVIDER",
  });
}
