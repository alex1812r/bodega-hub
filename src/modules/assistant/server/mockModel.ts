import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4StreamPart,
  LanguageModelV4Usage,
} from "@ai-sdk/provider";

/**
 * Modelo determinista para tests, e2e y arranque sin API key.
 * Ejercita el ciclo completo: elige una herramienta por palabras clave,
 * espera su resultado y redacta una respuesta con las cifras devueltas.
 * Nunca inventa numeros: todo lo que escribe sale del tool result.
 */

type Rule = { keywords: string[]; tool: string };

/** Orden importante: la primera regla que casa gana. */
const STORE_RULES: Rule[] = [
  { keywords: ["capital"], tool: "capital_actual" },
  { keywords: ["baul", "baúl"], tool: "capital_actual" },
  { keywords: ["repone", "reponer", "stock bajo", "agotad", "faltan"], tool: "stock_bajo" },
  { keywords: ["margen", "rentab", "deja mas", "deja más"], tool: "rentabilidad_productos" },
  { keywords: ["cliente"], tool: "top_clientes" },
  { keywords: ["proveedor", "compra", "comprado"], tool: "compras_periodo" },
  {
    keywords: ["pago movil", "pago móvil", "metodo de pago", "método de pago", "metodos de pago", "efectivo", "transferencia", "zelle"],
    tool: "metodos_pago",
  },
  { keywords: ["cerro", "cerró", "cierre", "cierra"], tool: "cierre_dia" },
  { keywords: ["ganancia", "utilidad", "beneficio"], tool: "ganancia_bruta" },
  { keywords: ["producto", "articulo", "artículo", "mas vendido", "más vendido", "top"], tool: "top_productos" },
  { keywords: ["vend", "vent", "factur", "ingres"], tool: "ventas_periodo" },
];

const PLATFORM_RULES: Rule[] = [
  { keywords: ["cuantas tiendas", "cuántas tiendas", "lista de tiendas", "listar tiendas", "que tiendas", "qué tiendas", "tiendas activas"], tool: "listar_tiendas" },
  { keywords: ["tienda", "compar", "ranking", "vend", "vent", "ganancia", "capital", "perdida", "pérdida"], tool: "comparar_tiendas" },
];

const OUT_OF_SCOPE = [
  "clima",
  "tiempo hace",
  "chiste",
  "receta",
  "futbol",
  "fútbol",
  "presidente",
  "traduc",
];

const WRITE_INTENT = ["borra", "elimina", "modifica", "actualiza", "crea ", "registra ", "anula"];

function normalize(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function lastUserText(options: LanguageModelV4CallOptions) {
  for (let index = options.prompt.length - 1; index >= 0; index -= 1) {
    const message = options.prompt[index]!;

    if (message.role === "user") {
      return message.content
        .filter((part): part is { text: string; type: "text" } => part.type === "text")
        .map((part) => part.text)
        .join(" ");
    }
  }

  return "";
}

function collectToolResults(options: LanguageModelV4CallOptions) {
  const results: Array<{ output: unknown; toolName: string }> = [];

  for (const message of options.prompt) {
    if (message.role !== "tool") {
      continue;
    }

    for (const part of message.content) {
      if (part.type !== "tool-result") {
        continue;
      }

      results.push({
        output: part.output.type === "json" ? part.output.value : part.output,
        toolName: part.toolName,
      });
    }
  }

  return results;
}

function availableToolNames(options: LanguageModelV4CallOptions) {
  return new Set((options.tools ?? []).map((entry) => entry.name));
}

function pickTool(question: string, options: LanguageModelV4CallOptions) {
  const available = availableToolNames(options);
  const normalized = normalize(question);
  const rules = available.has("comparar_tiendas") ? PLATFORM_RULES : STORE_RULES;

  if (OUT_OF_SCOPE.some((keyword) => normalized.includes(normalize(keyword)))) {
    return null;
  }

  if (WRITE_INTENT.some((keyword) => normalized.includes(normalize(keyword)))) {
    return null;
  }

  for (const rule of rules) {
    if (rule.keywords.some((keyword) => normalized.includes(normalize(keyword)))) {
      return available.has(rule.tool) ? rule.tool : null;
    }
  }

  return null;
}

function inferPreset(question: string) {
  const normalized = normalize(question);

  if (normalized.includes("desde ayer")) return "desde_ayer";
  if (normalized.includes("ayer")) return "ayer";
  if (normalized.includes("hoy")) return "hoy";
  if (normalized.includes("semana pasada")) return "semana_pasada";
  if (normalized.includes("esta semana") || normalized.includes("semana")) return "esta_semana";
  if (normalized.includes("mes pasado")) return "mes_pasado";
  if (normalized.includes("estos meses") || normalized.includes("ultimos meses")) {
    return "ultimos_3_meses";
  }
  if (normalized.includes("este mes") || normalized.includes("mes")) return "este_mes";
  if (normalized.includes("este ano") || normalized.includes("ano")) return "este_anio";

  return null;
}

const MONTHS: Record<string, string> = {
  enero: "01",
  febrero: "02",
  marzo: "03",
  abril: "04",
  mayo: "05",
  junio: "06",
  julio: "07",
  agosto: "08",
  septiembre: "09",
  setiembre: "09",
  octubre: "10",
  noviembre: "11",
  diciembre: "12",
};

/** "entre el 1 y el 15 de agosto" → rango explicito, para probar el camino from/to. */
function inferExplicitRange(question: string, today: string) {
  const normalized = normalize(question);
  const match = normalized.match(
    /entre el (\d{1,2}) y el (\d{1,2}) de ([a-z]+)|del (\d{1,2}) al (\d{1,2}) de ([a-z]+)/,
  );

  if (!match) {
    const yearMatch = normalized.match(/\b(19|20)\d{2}\b/);
    if (yearMatch) {
      const year = yearMatch[0];
      return { from: `${year}-01-01`, to: `${year}-12-31` };
    }
    return null;
  }

  const [fromDay, toDay, monthName] = match[1]
    ? [match[1], match[2]!, match[3]!]
    : [match[4]!, match[5]!, match[6]!];
  const month = MONTHS[monthName];

  if (!month) {
    return null;
  }

  const year = today.slice(0, 4);
  const pad = (value: string) => value.padStart(2, "0");

  return { from: `${year}-${month}-${pad(fromDay)}`, to: `${year}-${month}-${pad(toDay)}` };
}

function buildToolInput(toolName: string, question: string, today: string) {
  const input: Record<string, unknown> = {};

  if (toolName === "listar_tiendas") {
    return input;
  }

  if (toolName === "stock_bajo") {
    return { limit: 10 };
  }

  const explicit = inferExplicitRange(question, today);

  if (explicit) {
    Object.assign(input, explicit);
  } else {
    const preset = inferPreset(question);
    if (preset) {
      input.preset = preset;
    }
  }

  if (toolName === "cierre_dia") {
    return input.preset === "ayer" || normalize(question).includes("ayer")
      ? { fecha: undefined, preset: "ayer" }
      : {};
  }

  const limitMatch = normalize(question).match(/top\s*(\d{1,2})/);
  if (limitMatch) {
    input.limit = Number(limitMatch[1]);
  }

  if (toolName === "ganancia_bruta" && input.preset === "ultimos_3_meses") {
    input.agruparPor = "mes";
  }

  if (toolName === "ventas_periodo" && normalize(question).includes("compar")) {
    input.compararConPeriodoAnterior = true;
  }

  return input;
}

/** Aplana un tool result a "clave: valor" para redactar sin inventar cifras. */
function describeValue(value: unknown, prefix = "", depth = 0): string[] {
  if (depth > 2 || value == null) {
    return [];
  }

  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") {
    return [`${prefix}${value}`];
  }

  if (Array.isArray(value)) {
    return value.slice(0, 3).flatMap((item, index) => describeValue(item, `${prefix}${index + 1}. `, depth + 1));
  }

  return Object.entries(value as Record<string, unknown>)
    .slice(0, 8)
    .flatMap(([key, entry]) => describeValue(entry, `${prefix}${key}=`, depth + 1));
}

function buildAnswer(results: Array<{ output: unknown; toolName: string }>) {
  const lines: string[] = [];

  for (const result of results) {
    const output = result.output as
      | { data?: unknown; error?: string; note?: string; ok?: boolean; range?: { from: string; to: string } }
      | undefined;

    if (!output || output.ok === false) {
      lines.push(`No pude obtener los datos: ${output?.error ?? "error desconocido"}.`);
      continue;
    }

    const facts = describeValue(output.data).slice(0, 8);
    const range = output.range ? ` (rango ${output.range.from} a ${output.range.to})` : "";

    lines.push(
      facts.length > 0
        ? `Resultado de ${result.toolName}${range}: ${facts.join("; ")}.`
        : `La herramienta ${result.toolName}${range} no devolvio datos para ese rango.`,
    );

    if (output.note) {
      lines.push(output.note);
    }
  }

  return lines.join("\n");
}

const REFUSAL =
  "Solo puedo responder sobre los datos de BodegaHub: ventas, ganancia, productos, clientes, compras, stock, caja/baul y capital. No tengo herramientas para eso ni puedo modificar informacion.";

const ZERO_USAGE: LanguageModelV4Usage = {
  inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 0, total: 0 },
  outputTokens: { reasoning: 0, text: 0, total: 0 },
};

function textStream(text: string): LanguageModelV4StreamPart[] {
  return [
    { type: "stream-start", warnings: [] },
    { id: "0", type: "text-start" },
    { delta: text, id: "0", type: "text-delta" },
    { id: "0", type: "text-end" },
    { finishReason: { raw: "stop", unified: "stop" }, type: "finish", usage: ZERO_USAGE },
  ];
}

export type MockAssistantModelOptions = {
  /** Fuerza un fallo del proveedor para probar el manejo de errores. */
  failWith?: Error;
  today?: string;
};

export function createMockAssistantModel(
  options: MockAssistantModelOptions = {},
): LanguageModelV4 {
  return {
    modelId: "assistant-mock",
    provider: "bodegahub-mock",
    specificationVersion: "v4",
    supportedUrls: {},
    async doGenerate() {
      throw new Error("El modelo mock solo soporta streaming.");
    },
    async doStream(callOptions: LanguageModelV4CallOptions) {
      if (options.failWith) {
        throw options.failWith;
      }

      const question = lastUserText(callOptions);
      const results = collectToolResults(callOptions);
      const parts: LanguageModelV4StreamPart[] =
        results.length > 0
          ? textStream(buildAnswer(results))
          : (() => {
              const toolName = pickTool(question, callOptions);

              if (!toolName) {
                return textStream(REFUSAL);
              }

              const input = JSON.stringify(
                buildToolInput(toolName, question, options.today ?? "2026-09-02"),
              );

              return ([
                { type: "stream-start", warnings: [] },
                { id: "call-1", toolName, type: "tool-input-start" },
                { delta: input, id: "call-1", type: "tool-input-delta" },
                { id: "call-1", type: "tool-input-end" },
                { input, toolCallId: "call-1", toolName, type: "tool-call" },
                { finishReason: { raw: "tool-calls", unified: "tool-calls" }, type: "finish", usage: ZERO_USAGE },
              ] satisfies LanguageModelV4StreamPart[]);
            })();

      return {
        stream: new ReadableStream<LanguageModelV4StreamPart>({
          start(controller) {
            for (const part of parts) {
              controller.enqueue(part);
            }
            controller.close();
          },
        }),
      };
    },
  };
}
