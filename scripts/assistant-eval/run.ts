/**
 * Banco de preguntas contra /api/chat.
 *
 *   npm run assistant:eval                       # proveedor segun .env.local
 *   ASSISTANT_PROVIDER=mock npm run assistant:eval
 *   ASSISTANT_EVAL_ONLY=a01,a02 npm run assistant:eval
 *
 * Requiere el dev server arriba con ALLOW_DEMO_AUTH=true.
 * Verifica: (a) se llamo la herramienta esperada, (b) el rango efectivo,
 * (c) la respuesta cita la cifra principal, (d) no aparecen numeros
 * que no esten en ningun resultado de herramienta.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  resolveRange,
  type AssistantDatePreset,
} from "../../src/modules/assistant/server/dates";
import { getCaracasIsoDate } from "../../src/shared/utils/caracasBusinessDay";

type Question = {
  expectAnyTool?: string[];
  expectEmpty?: boolean;
  expectFrom?: string;
  expectInvalidDate?: boolean;
  expectRange?: string;
  expectRefusal?: boolean;
  expectTo?: string;
  expectTool?: string;
  expectToolFailure?: boolean;
  id: string;
  question: string;
  role: "admin" | "superadmin";
};

type ToolCall = {
  input: unknown;
  name: string;
  output?: {
    data?: unknown;
    error?: string;
    note?: string;
    ok?: boolean;
    range?: { from: string; to: string };
  };
};

type Result = {
  failures: string[];
  id: string;
  ok: boolean;
  question: string;
  role: string;
  text: string;
  tools: ToolCall[];
};

const BASE_URL = process.env.ASSISTANT_EVAL_BASE_URL ?? "http://localhost:3000";
/** El free tier de Gemini limita por minuto; sin pausa el banco se cae solo. */
const DELAY_MS = Number.parseInt(process.env.ASSISTANT_EVAL_DELAY_MS ?? "0", 10) || 0;
const RETRIES = Number.parseInt(process.env.ASSISTANT_EVAL_RETRIES ?? "2", 10) || 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const HERE = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

function loadQuestions(): Question[] {
  const all = JSON.parse(readFileSync(join(HERE, "questions.json"), "utf8")) as Question[];
  const only = process.env.ASSISTANT_EVAL_ONLY?.split(",").map((id) => id.trim()).filter(Boolean);

  return only?.length ? all.filter((entry) => only.includes(entry.id)) : all;
}

async function ask(question: Question) {
  const response = await fetch(`${BASE_URL}/api/chat`, {
    body: JSON.stringify({
      messages: [
        { id: `${question.id}-1`, parts: [{ text: question.question, type: "text" }], role: "user" },
      ],
    }),
    headers: { "content-type": "application/json", "x-demo-role": question.role },
    method: "POST",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status}: ${body.slice(0, 300)}`);
  }

  const raw = await response.text();
  const tools = new Map<string, ToolCall>();
  let text = "";

  for (const line of raw.split("\n")) {
    if (!line.startsWith("data: ") || line === "data: [DONE]") {
      continue;
    }

    let chunk: Record<string, unknown>;

    try {
      chunk = JSON.parse(line.slice(6)) as Record<string, unknown>;
    } catch {
      continue;
    }

    const id = String(chunk.toolCallId ?? "");

    if (chunk.type === "text-delta") {
      text += String(chunk.delta ?? "");
    } else if (chunk.type === "tool-input-available") {
      tools.set(id, { input: chunk.input, name: String(chunk.toolName ?? "") });
    } else if (chunk.type === "tool-output-available") {
      const current = tools.get(id) ?? { input: null, name: "" };
      tools.set(id, { ...current, output: chunk.output as ToolCall["output"] });
    } else if (chunk.type === "error") {
      throw new Error(String(chunk.errorText ?? "error en el stream"));
    }
  }

  return { text: text.trim(), tools: [...tools.values()] };
}

/** Numeros con al menos 2 digitos: los de 1 digito generan demasiado ruido. */
function extractNumbers(text: string) {
  return [...text.matchAll(/\d[\d.,]*/g)]
    .map((match) => match[0].replace(/[.,](?=\d{3}\b)/g, "").replace(",", "."))
    .map((value) => Number.parseFloat(value))
    .filter((value) => Number.isFinite(value) && Math.abs(value) >= 10);
}

function collectKnownNumbers(tools: ToolCall[]) {
  const known = new Set<number>();

  const walk = (value: unknown) => {
    if (typeof value === "number") {
      known.add(Math.round(value * 100) / 100);
      known.add(Math.round(value));
      return;
    }

    if (typeof value === "string") {
      for (const number of extractNumbers(value)) {
        known.add(number);
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }

    if (value && typeof value === "object") {
      Object.values(value as Record<string, unknown>).forEach(walk);
    }
  };

  tools.forEach((tool) => {
    walk(tool.output);
    walk(tool.input);
  });

  // Los años del rango y del calendario no cuentan como cifras inventadas.
  for (let year = 2019; year <= 2030; year += 1) {
    known.add(year);
  }

  return known;
}

function isKnown(value: number, known: Set<number>) {
  for (const candidate of known) {
    if (Math.abs(candidate - value) < 0.011 || Math.abs(Math.round(candidate) - value) < 0.011) {
      return true;
    }
  }

  return false;
}

/** Reintenta solo los fallos del proveedor (429 / 502), no los de evaluacion. */
async function askWithRetries(question: Question) {
  let lastError: unknown;

  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    try {
      return await ask(question);
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);

      if (!/HTTP 429|HTTP 502|no esta disponible/i.test(message)) {
        throw error;
      }

      await sleep(20_000 * (attempt + 1));
    }
  }

  throw lastError;
}

function evaluate(question: Question, answer: { text: string; tools: ToolCall[] }): Result {
  const failures: string[] = [];
  const names = answer.tools.map((tool) => tool.name);

  if (question.expectRefusal || question.expectInvalidDate) {
    const calledForbidden = question.expectRefusal && names.length > 0;
    const answered = answer.text.length > 0;

    if (!answered) {
      failures.push("no hubo respuesta de texto");
    }

    if (calledForbidden && answer.tools.every((tool) => tool.output?.ok !== false)) {
      failures.push(`debia negarse pero llamo ${names.join(", ")}`);
    }
  } else {
    const expected = question.expectAnyTool ?? (question.expectTool ? [question.expectTool] : []);

    if (expected.length > 0 && !expected.some((name) => names.includes(name))) {
      failures.push(`esperaba ${expected.join(" o ")}, llamo ${names.join(", ") || "ninguna"}`);
    }

    const primary =
      answer.tools.find((tool) => expected.includes(tool.name)) ?? answer.tools[0];

    if (question.expectFrom && primary?.output?.range?.from !== question.expectFrom) {
      failures.push(`from esperado ${question.expectFrom}, obtuvo ${primary?.output?.range?.from}`);
    }

    if (question.expectTo && primary?.output?.range?.to !== question.expectTo) {
      failures.push(`to esperado ${question.expectTo}, obtuvo ${primary?.output?.range?.to}`);
    }

    if (question.expectRange && primary?.output?.range) {
      const expectedRange = resolveRange(
        { preset: question.expectRange as AssistantDatePreset },
        getCaracasIsoDate(),
      );

      if (
        primary.output.range.from !== expectedRange.from ||
        primary.output.range.to !== expectedRange.to
      ) {
        failures.push(
          `rango esperado ${expectedRange.from}..${expectedRange.to} (${question.expectRange}), obtuvo ${primary.output.range.from}..${primary.output.range.to}`,
        );
      }
    }

    if (question.expectEmpty && primary?.output?.ok === true) {
      const serialized = JSON.stringify(primary.output.data ?? {});
      const hasData = /[1-9]/.test(serialized.replace(/"[^"]*":/g, ""));

      if (hasData) {
        failures.push("esperaba un resultado vacio");
      }
    }

    if (question.expectToolFailure && primary?.output?.ok !== false) {
      failures.push("esperaba un fallo controlado de la herramienta");
    }

    if (answer.text.length === 0) {
      failures.push("no hubo respuesta de texto");
    }
  }

  const known = collectKnownNumbers(answer.tools);
  const invented = extractNumbers(answer.text).filter((value) => !isKnown(value, known));

  if (invented.length > 0) {
    failures.push(`numeros no respaldados: ${invented.slice(0, 5).join(", ")}`);
  }

  return {
    failures,
    id: question.id,
    ok: failures.length === 0,
    question: question.question,
    role: question.role,
    text: answer.text,
    tools: answer.tools,
  };
}

async function main() {
  const questions = loadQuestions();
  const results: Result[] = [];

  console.log(`Asistente — banco de preguntas (${questions.length})`);
  console.log(`Base URL: ${BASE_URL}`);
  console.log("");

  for (const [index, question] of questions.entries()) {
    if (index > 0 && DELAY_MS > 0) {
      await sleep(DELAY_MS);
    }

    try {
      const answer = await askWithRetries(question);
      const result = evaluate(question, answer);
      results.push(result);
      console.log(
        `${result.ok ? "PASS" : "FAIL"}  ${question.id.padEnd(4)} ${question.question.slice(0, 58).padEnd(58)} ${
          result.tools.map((tool) => tool.name).join(",") || "-"
        }`,
      );

      for (const failure of result.failures) {
        console.log(`        ↳ ${failure}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        failures: [message],
        id: question.id,
        ok: false,
        question: question.question,
        role: question.role,
        text: "",
        tools: [],
      });
      console.log(`ERR   ${question.id.padEnd(4)} ${question.question.slice(0, 58)}`);
      console.log(`        ↳ ${message.slice(0, 200)}`);
    }
  }

  const passed = results.filter((result) => result.ok).length;
  const invented = results.filter((result) =>
    result.failures.some((failure) => failure.startsWith("numeros no respaldados")),
  );

  console.log("");
  console.log(`Correctas: ${passed}/${results.length}`);
  console.log(`Con numeros inventados: ${invented.length}`);

  const outputPath = join(HERE, "last-run.json");
  mkdirSync(HERE, { recursive: true });
  writeFileSync(
    outputPath,
    JSON.stringify(
      { finishedAt: new Date().toISOString(), passed, results, total: results.length },
      null,
      2,
    ),
  );
  console.log(`Detalle: ${outputPath}`);

  process.exit(passed === results.length ? 0 : 1);
}

void main();
