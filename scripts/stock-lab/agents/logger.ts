/**
 * Logger JSONL de eventos de los agentes del laboratorio de stock (STK-302).
 *
 * Cada request HTTP de un agente = una línea en
 * `scripts/stock-lab/runs/<runId>/events.jsonl` (append síncrono, varios
 * procesos escriben al mismo archivo).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type LabEvent = {
  /** ISO 8601 (lo rellena el logger). */
  ts: string;
  /** Nombre del agente (lo rellena el logger). */
  agent: string;
  /** OpKind de expected-delta.ts o `chaos_*`/`agent_error`. */
  op: string;
  /** Body enviado + ids relevantes. */
  payload: unknown;
  /** HTTP status; 0 si no hubo respuesta (error del agente). */
  status: number;
  /** Id devuelto por el API (venta/compra/ajuste) o null. */
  response_id: string | null;
  /** productId → delta de stock esperado. Solo en 2xx; en otro caso `{}`. */
  expected_delta: Record<string, number>;
  error?: string;
};

export const EVENTS_FILE_NAME = "events.jsonl";

/** Carpeta por defecto de los runs: `<raíz repo>/scripts/stock-lab/runs`. */
export function defaultRunsRootDir(): string {
  // scripts/stock-lab/agents/logger.ts -> scripts/stock-lab/runs
  return resolve(__dirname, "..", "runs");
}

export function isSuccessStatus(status: number): boolean {
  return status >= 200 && status <= 299;
}

export class EventLogger {
  readonly runId: string;
  readonly agent: string;
  readonly rootDir: string;
  private readonly file: string;
  private dirReady = false;

  constructor(runId: string, agent: string, rootDir: string = defaultRunsRootDir()) {
    if (!runId.trim()) {
      throw new Error("EventLogger: runId vacío.");
    }
    if (!agent.trim()) {
      throw new Error("EventLogger: agent vacío.");
    }
    this.runId = runId;
    this.agent = agent;
    this.rootDir = rootDir;
    this.file = resolve(rootDir, runId, EVENTS_FILE_NAME);
  }

  get filePath(): string {
    return this.file;
  }

  /**
   * Añade una línea JSON al archivo del run. Rellena `ts` y `agent`; si el
   * status no es 2xx fuerza `expected_delta: {}` aunque el llamador pase algo.
   * Devuelve el evento tal y como se escribió.
   */
  log(event: Omit<LabEvent, "ts" | "agent">): LabEvent {
    const written: LabEvent = {
      ts: new Date().toISOString(),
      agent: this.agent,
      op: event.op,
      payload: event.payload,
      status: event.status,
      response_id: event.response_id ?? null,
      expected_delta: isSuccessStatus(event.status) ? { ...event.expected_delta } : {},
    };
    if (event.error !== undefined) {
      written.error = event.error;
    }
    if (!this.dirReady) {
      mkdirSync(dirname(this.file), { recursive: true });
      this.dirReady = true;
    }
    appendFileSync(this.file, `${JSON.stringify(written)}\n`, "utf8");
    return written;
  }
}

/** Lee un events.jsonl y devuelve sus eventos (ignora líneas vacías). */
export function readEvents(filePath: string): LabEvent[] {
  if (!existsSync(filePath)) {
    return [];
  }
  const text = readFileSync(filePath, "utf8");
  const events: LabEvent[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    events.push(JSON.parse(line) as LabEvent);
  }
  return events;
}
