/**
 * Lógica pura de la suite UI del laboratorio de stock (STK-404, plan
 * stock-integrity §8.3): argumentos, parser de números es-VE, comparador
 * UI ↔ base, filas del Excel de importación y formato de resultados.
 *
 * Sin red, sin base y sin navegador: todo lo de aquí se prueba en
 * helpers.test.ts.
 */

// ---------------------------------------------------------------------------
// Resultados (formato común de phase4-contracts.md)
// ---------------------------------------------------------------------------

export type Verdict = "pass" | "fail" | "finding" | "error" | "skip";

export const VERDICTS: readonly Verdict[] = ["pass", "fail", "finding", "error", "skip"];

export type UiStep = {
  op: string;
  as?: string;
  status?: number;
  response_id?: string | null;
  ms?: number;
  note?: string;
};

/**
 * `plan`: el caso verifica el esperado literal del flujo en el plan §8.3 y decide
 * el veredicto del flujo. `extra`: variante añadida por la ola (doble clic al
 * recibir, salida mayor que el stock…); se informa aparte y no lo decide.
 */
export type CaseScope = "plan" | "extra";

export type UiResult = {
  ts: string;
  suite: "ui";
  id: string;
  scope: CaseScope;
  title: string;
  hypothesis: string[];
  steps: UiStep[];
  /** Texto literal que mostró la pantalla (toasts, alertas, diálogos, botones, celdas). */
  ui_says: string[];
  expected: Record<string, unknown>;
  actual: Record<string, unknown>;
  reconcile_scoped: Record<string, number>;
  reconcile_global: Record<string, number>;
  verdict: Verdict;
  detail: string;
  evidence: string[];
};

export function countVerdicts(results: readonly Pick<UiResult, "verdict">[]): Record<Verdict, number> {
  const counts: Record<Verdict, number> = { pass: 0, fail: 0, finding: 0, error: 0, skip: 0 };
  for (const result of results) counts[result.verdict] += 1;
  return counts;
}

export function formatVerdictSummary(counts: Record<Verdict, number>): string {
  return VERDICTS.map((verdict) => `${verdict}=${counts[verdict]}`).join(" ");
}

const VERDICT_RANK: Record<Verdict, number> = { skip: 0, pass: 1, finding: 2, fail: 3, error: 4 };

/** El peor veredicto de una lista (error > fail > finding > pass > skip); `skip` si está vacía. */
export function worstVerdict(verdicts: readonly Verdict[]): Verdict {
  let worst: Verdict = "skip";
  for (const verdict of verdicts) {
    if (VERDICT_RANK[verdict] > VERDICT_RANK[worst]) worst = verdict;
  }
  return worst;
}

function mdCell(text: string): string {
  return text.replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
}

export const MD_HEADER = [
  "| id | veredicto | título | detalle | la UI dijo | evidencia |",
  "| --- | --- | --- | --- | --- | --- |",
].join("\n");

export function toMarkdownRow(result: UiResult): string {
  const says = result.ui_says.slice(0, 6).join(" · ");
  const evidence = result.evidence.slice(0, 8).join(", ");
  return `| ${[result.id, result.verdict, result.title, result.detail, says, evidence].map(mdCell).join(" | ")} |`;
}

// ---------------------------------------------------------------------------
// Resumen por flujo (plan §8.3: 10 flujos) y capturas
// ---------------------------------------------------------------------------

export type FlowSummary = {
  n: number;
  id: string;
  /** Peor veredicto de los casos `plan`; `error` si el flujo no ejecutó ninguno. */
  verdict: Verdict;
  /** Peor veredicto de los casos `extra`; `null` si no hay. */
  extras: Verdict | null;
  cases: number;
  /** Rutas de las capturas PNG de todos los casos del flujo, en orden. */
  shots: string[];
};

/** `f03.ii_cut` → 3; `null` si el id no es de un flujo. */
export function flowOfCase(id: string): number | null {
  const match = /^f(\d{2})(?:\.|$)/.exec(id);
  return match ? Number(match[1]) : null;
}

export function summarizeFlows(results: readonly UiResult[], flows: readonly number[]): FlowSummary[] {
  return flows.map((n) => {
    const own = results.filter((result) => flowOfCase(result.id) === n);
    const plan = own.filter((result) => result.scope === "plan").map((result) => result.verdict);
    const extra = own.filter((result) => result.scope === "extra").map((result) => result.verdict);
    return {
      n,
      id: `f${String(n).padStart(2, "0")}`,
      verdict: plan.length > 0 ? worstVerdict(plan) : "error",
      extras: extra.length > 0 ? worstVerdict(extra) : null,
      cases: own.length,
      shots: own.flatMap((result) => result.evidence.filter((file) => /\.png$/i.test(file))),
    };
  });
}

/** Lo que impide dar el flujo por probado: no corrió, o no dejó captura. Vacío = cobertura completa. */
export function flowCoverageProblems(flows: readonly FlowSummary[]): string[] {
  const problems: string[] = [];
  for (const flow of flows) {
    if (flow.cases === 0) problems.push(`${flow.id}: no se ejecutó ningún caso`);
    else if (flow.shots.length === 0) problems.push(`${flow.id}: no dejó ninguna captura`);
  }
  return problems;
}

/** Tabla flujo → veredicto y, debajo, la lista completa de capturas de cada flujo. */
export function flowsMarkdown(flows: readonly FlowSummary[]): string {
  return [
    "## Flujos (plan §8.3)",
    "",
    "| flujo | veredicto (plan) | extras | casos | capturas |",
    "| --- | --- | --- | --- | --- |",
    ...flows.map((flow) => `| ${flow.id} | ${flow.verdict} | ${flow.extras ?? "—"} | ${flow.cases} | ${flow.shots.length} |`),
    "",
    "## Capturas por flujo",
    ...flows.flatMap((flow) => ["", `### ${flow.id}`, "", ...(flow.shots.length > 0 ? flow.shots.map((file) => `- ${file}`) : ["- (ninguna)"])]),
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export type UiArgs = {
  run: string;
  only: number[] | null;
  headed: boolean;
  list: boolean;
  help: boolean;
  out: string | null;
  shots: string | null;
  seller: "vendedor1" | "vendedor2";
};

export const UI_USAGE = [
  "npm run stock-lab:ui -- [opciones]",
  "",
  "  --run <id>       id del run (por defecto YYYYMMDD-HHmmss-ui)",
  "  --only <lista>   solo esos flujos: 1,2,5 o f01,f02 (por defecto los 10)",
  "  --seller <u>     vendedor1 (por defecto) o vendedor2",
  "  --headed         navegador visible",
  "  --out <dir>      raíz de ui.jsonl / ui.md (por defecto scripts/stock-lab/runs)",
  "  --shots <dir>    raíz de las capturas (por defecto .notes/stock-integrity-gtm/qa/ui)",
  "  --list           lista los flujos y sale",
  "  --help, -h       esta ayuda",
  "",
  "Veredictos: pass (el producto cumple el esperado del plan §8.3), fail (bug de",
  "producto), finding (stock bien, carencia de UX), error (el caso no se ejecutó).",
].join("\n");

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** `YYYYMMDD-HHmmss-ui` en hora local. */
export function defaultRunId(now: Date = new Date()): string {
  const date = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
  const time = `${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
  return `${date}-${time}-ui`;
}

/** `"1,2,f05, 7"` → `[1,2,5,7]` (sin duplicados, orden ascendente). Lanza si hay un id inválido. */
export function parseOnly(value: string): number[] {
  const out = new Set<number>();
  for (const raw of value.split(",")) {
    const token = raw.trim().toLowerCase();
    if (!token) continue;
    const match = /^f?0*(\d{1,2})$/.exec(token);
    const n = match ? Number(match[1]) : Number.NaN;
    if (!Number.isInteger(n) || n < 1 || n > 10) {
      throw new Error(`--only: "${raw.trim()}" no es un flujo válido (1..10 o f01..f10).`);
    }
    out.add(n);
  }
  if (out.size === 0) throw new Error("--only: lista vacía.");
  return [...out].sort((a, b) => a - b);
}

export function parseUiArgs(argv: readonly string[], now: Date = new Date()): UiArgs {
  const args: UiArgs = {
    run: defaultRunId(now),
    only: null,
    headed: false,
    list: false,
    help: false,
    out: null,
    shots: null,
    seller: "vendedor1",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = (): string => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`${flag} necesita un valor.`);
      i += 1;
      return value;
    };
    if (flag === "--headed") args.headed = true;
    else if (flag === "--list") args.list = true;
    else if (flag === "--help" || flag === "-h") args.help = true;
    else if (flag === "--run") {
      const run = next().trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(run)) {
        throw new Error(`--run: "${run}" solo admite letras, números, punto, guion y guion bajo.`);
      }
      args.run = run;
    } else if (flag === "--only") args.only = parseOnly(next());
    else if (flag === "--out") args.out = next();
    else if (flag === "--shots") args.shots = next();
    else if (flag === "--seller") {
      const seller = next();
      if (seller !== "vendedor1" && seller !== "vendedor2") {
        throw new Error("--seller: vendedor1 o vendedor2.");
      }
      args.seller = seller;
    } else throw new Error(`Argumento desconocido: ${flag}`);
  }
  return args;
}

export function flowId(n: number): string {
  return `f${pad2(n)}`;
}

/** Nombre de archivo de captura: `f03-ii-02-tras-clic.png` (sin espacios ni acentos). */
export function shotFileName(caseId: string, index: number, step: string): string {
  const slug = (text: string) =>
    text
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  return `${slug(caseId)}-${pad2(index)}-${slug(step) || "paso"}.png`;
}

// ---------------------------------------------------------------------------
// Números con formato es-VE
// ---------------------------------------------------------------------------

/**
 * Extrae el primer número de un texto de la UI. La app mezcla formatos:
 * bolívares en es-VE (`Bs. 1.437,76`), REF con punto decimal (`ref 2.75`) y
 * enteros con sufijo o signo (`45 un`, `+36`, `−2`, `- 3`).
 *
 * - coma y punto juntos: el último es el decimal;
 * - solo coma: decimal;
 * - solo punto: miles si casa `d{1,3}(.ddd)+`, si no decimal.
 *
 * Devuelve `null` si no hay número.
 */
export function parseEsNumber(text: string | null | undefined): number | null {
  if (text === null || text === undefined) return null;
  const normalized = text.replace(/[−–—]/g, "-").replace(/ /g, " ");
  const match = /([+-]\s*)?(\d[\d.,]*)/.exec(normalized);
  if (!match) return null;
  const negative = (match[1] ?? "").trim() === "-";
  let digits = (match[2] ?? "").replace(/[.,]+$/, "");
  const lastComma = digits.lastIndexOf(",");
  const lastDot = digits.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    digits =
      lastComma > lastDot
        ? digits.replace(/\./g, "").replace(",", ".")
        : digits.replace(/,/g, "");
  } else if (lastComma >= 0) {
    digits = /^\d{1,3}(,\d{3})+$/.test(digits) && digits.split(",").length > 2
      ? digits.replace(/,/g, "")
      : digits.replace(",", ".");
  } else if (lastDot >= 0 && /^\d{1,3}(\.\d{3})+$/.test(digits)) {
    digits = digits.replace(/\./g, "");
  }
  const value = Number(digits);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

/** Como `parseEsNumber` pero exige entero (stock, cantidades); `null` si no lo es. */
export function parseStockInt(text: string | null | undefined): number | null {
  const value = parseEsNumber(text);
  return value !== null && Number.isInteger(value) ? value : null;
}

// ---------------------------------------------------------------------------
// Instantáneas de base y comparación
// ---------------------------------------------------------------------------

export type MovementRow = {
  id: string;
  product_id: string;
  type: string;
  quantity_delta: number;
  stock_after: number;
  sale_id: string | null;
  purchase_id: string | null;
  conversion_id: string | null;
};

export type SaleRow = {
  id: string;
  invoice_number: string;
  status: string;
  client_request_id: string | null;
};

export type SaleItemRow = { id: string; sale_id: string; product_id: string; quantity: number };
export type PaymentRow = { id: string; sale_id: string | null; purchase_id: string | null; status: string };
export type PurchaseRow = { id: string; purchase_number: string; status: string };

export type DbSnapshot = {
  stock: Record<string, number>;
  movements: MovementRow[];
  sales: SaleRow[];
  saleItems: SaleItemRow[];
  payments: PaymentRow[];
  purchases: PurchaseRow[];
};

export type DbDiff = {
  stockDelta: Record<string, number>;
  movements: MovementRow[];
  sales: SaleRow[];
  saleItems: SaleItemRow[];
  payments: PaymentRow[];
  purchases: PurchaseRow[];
  /** Documentos que ya existían y cambiaron de estado: `{ id: "antes→después" }`. */
  statusChanges: Record<string, string>;
};

function newRows<T extends { id: string }>(before: readonly T[], after: readonly T[]): T[] {
  const seen = new Set(before.map((row) => row.id));
  return after.filter((row) => !seen.has(row.id));
}

export function diffSnapshots(before: DbSnapshot, after: DbSnapshot): DbDiff {
  const stockDelta: Record<string, number> = {};
  for (const id of new Set([...Object.keys(before.stock), ...Object.keys(after.stock)])) {
    stockDelta[id] = (after.stock[id] ?? 0) - (before.stock[id] ?? 0);
  }
  const statusChanges: Record<string, string> = {};
  const previous = new Map<string, string>();
  for (const row of [...before.sales, ...before.purchases, ...before.payments]) previous.set(row.id, row.status);
  for (const row of [...after.sales, ...after.purchases, ...after.payments]) {
    const old = previous.get(row.id);
    if (old !== undefined && old !== row.status) statusChanges[row.id] = `${old}→${row.status}`;
  }
  return {
    stockDelta,
    movements: newRows(before.movements, after.movements),
    sales: newRows(before.sales, after.sales),
    saleItems: newRows(before.saleItems, after.saleItems),
    payments: newRows(before.payments, after.payments),
    purchases: newRows(before.purchases, after.purchases),
    statusChanges,
  };
}

/** Suma `quantity_delta` por producto, opcionalmente solo de ciertos tipos. */
export function sumMovements(rows: readonly MovementRow[], types?: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    if (types && !types.includes(row.type)) continue;
    out[row.product_id] = (out[row.product_id] ?? 0) + row.quantity_delta;
  }
  return out;
}

export function sumSaleItems(rows: readonly SaleItemRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) out[row.product_id] = (out[row.product_id] ?? 0) + row.quantity;
  return out;
}

/**
 * Compara dos mapas `clave → número`. Una clave ausente vale 0. Devuelve una
 * frase por diferencia (`etiqueta: esperado 2, real 4`); vacío si coinciden.
 */
export function diffNumberMaps(
  expected: Readonly<Record<string, number>>,
  actual: Readonly<Record<string, number>>,
  labels: Readonly<Record<string, string>> = {},
): string[] {
  const diffs: string[] = [];
  for (const key of [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()) {
    const want = expected[key] ?? 0;
    const got = actual[key] ?? 0;
    if (want !== got) diffs.push(`${labels[key] ?? key}: esperado ${want}, real ${got}`);
  }
  return diffs;
}

/** Qué afirmó la pantalla sobre la operación. */
export type UiClaim = "success" | "error" | "none";

export type UiDbJudgement = { verdict: "pass" | "fail"; detail: string };

/**
 * Núcleo de H8: compara lo que la UI DICE con lo que hay en la BASE.
 *
 * - `expectedDocs`: documentos (ventas, compras, movimientos…) que debían nacer;
 * - `createdDocs`: los que nacieron de verdad;
 * - `uiClaim`: éxito / error / nada.
 *
 * Sano = la UI afirma éxito si y solo si la base tiene exactamente lo esperado,
 * y nunca hay más documentos de los esperados.
 */
export function judgeUiVsDb(input: {
  what: string;
  uiClaim: UiClaim;
  expectedDocs: number;
  createdDocs: number;
}): UiDbJudgement {
  const { what, uiClaim, expectedDocs, createdDocs } = input;
  if (createdDocs > Math.max(expectedDocs, 1)) {
    return {
      verdict: "fail",
      detail: `Duplicado: se esperaba como máximo ${Math.max(expectedDocs, 1)} ${what} y la base tiene ${createdDocs}.`,
    };
  }
  if (uiClaim === "success" && createdDocs === 0) {
    return { verdict: "fail", detail: `Éxito falso: la UI afirma éxito y la base no tiene ${what}.` };
  }
  if (uiClaim !== "success" && createdDocs > 0) {
    return {
      verdict: "fail",
      detail:
        uiClaim === "error"
          ? `Error falso: la UI dice que falló y la base sí registró ${createdDocs} ${what}.`
          : `Operación muda: la base registró ${createdDocs} ${what} y la UI no dijo nada.`,
    };
  }
  if (uiClaim === "success" && createdDocs !== expectedDocs) {
    return {
      verdict: "fail",
      detail: `La UI afirma éxito pero se esperaban ${expectedDocs} ${what} y hay ${createdDocs}.`,
    };
  }
  if (uiClaim !== "success" && expectedDocs > 0) {
    return {
      verdict: "fail",
      detail: `Se esperaban ${expectedDocs} ${what}; la UI ${uiClaim === "error" ? "mostró error" : "no dijo nada"} y la base no registró ninguno.`,
    };
  }
  return { verdict: "pass", detail: "" };
}

// ---------------------------------------------------------------------------
// Respuesta perdida tras el commit (flujo 3)
// ---------------------------------------------------------------------------

/** Lo que el POS muestra en un momento dado. */
export type PosView = {
  claim: UiClaim;
  text: string;
  /** Factura que anuncia el overlay «Venta registrada», si lo hay. */
  invoice: string | null;
  /** El aviso trae el botón «Verificar». */
  verifyOffered: boolean;
};

/** El aviso de cobro de resultado desconocido: «La venta pudo haberse registrado…». */
export function isUnknownOutcomeNotice(text: string): boolean {
  return /(pudo|puede) haberse registrado/i.test(text);
}

export type LostResponseInput = {
  /** Diferencias de la base contra «una venta y un juego de movimientos» (vacío = sana). */
  dbProblems: readonly string[];
  /** Factura de la única venta del carrito en la base. */
  dbInvoice: string | null;
  salesAtCut: number;
  /** POST /api/sales que salieron antes de que el cajero hiciera nada. */
  postsAtCut: number;
  /** El POS justo después del corte. */
  atCut: PosView;
  /** El POS al volver (recarga / salir y volver), antes de tocar nada. */
  onReturn?: PosView | null;
  /** El POS al final, con la red de vuelta y la acción del cajero hecha. */
  final: PosView;
};

/**
 * Esperado del plan §8.3 flujo 3: una sola venta, y la UI o bien la muestra o
 * bien avisa de que no se sabe y deja verificar; con la red de vuelta acaba
 * nombrando la venta registrada (overlay de éxito o aviso con su factura).
 */
export function judgeLostResponse(input: LostResponseInput): UiDbJudgement {
  const { atCut, final, onReturn, dbInvoice } = input;
  const problems: string[] = [...input.dbProblems];
  const warned = (view: PosView) => view.claim !== "success" && isUnknownOutcomeNotice(view.text) && view.verifyOffered;

  if (atCut.claim === "success") {
    if (input.salesAtCut === 0) problems.unshift("Éxito falso: la UI afirmó «Venta registrada» sin venta en la base.");
    else if (atCut.invoice !== dbInvoice) problems.push(`la UI anunció la factura ${atCut.invoice} y la base tiene ${dbInvoice}`);
  } else if (input.salesAtCut > 0 && !warned(atCut)) {
    problems.push(
      `la venta ya estaba en la base y la UI solo dijo «${atCut.text}»${atCut.verifyOffered ? "" : " sin ofrecer «Verificar»"}: no avisa de que pudo registrarse`,
    );
  }
  if (input.postsAtCut > 1) problems.push(`el cliente reintentó solo (${input.postsAtCut} POST antes de la acción del cajero)`);
  // Sin aviso en el corte (ya denunciado arriba) no hay aviso que conservar.
  if (onReturn && warned(atCut) && !warned(onReturn)) {
    problems.push(`al volver al POS el aviso desapareció (la UI mostró «${onReturn.text || "nada"}»)`);
  }
  const namesSale =
    dbInvoice !== null && (final.claim === "success" ? final.invoice === dbInvoice : final.text.includes(dbInvoice));
  if (dbInvoice !== null && !namesSale) {
    problems.push(
      `con la red de vuelta la UI no muestra la venta ${dbInvoice} (${final.claim}: «${final.claim === "success" ? final.invoice : final.text}»)`,
    );
  }
  return problems.length > 0 ? { verdict: "fail", detail: problems.join(" · ") } : { verdict: "pass", detail: "" };
}

// ---------------------------------------------------------------------------
// Ajuste libre de stock (flujo 6)
// ---------------------------------------------------------------------------

const FREE_ADJUSTMENT_TYPES = ["Ajuste entrada", "Ajuste salida", "Inventario inicial"] as const;

function foldLabel(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * El modal «Ajuste de stock» solo puede ofrecer entrada, salida e inventario
 * inicial: una devolución sin venta/compra ligada no tiene tope (R4 / C15).
 * Recibe las etiquetas del selector «Tipo de movimiento»; vacío = correcto.
 */
export function adjustmentTypeProblems(labels: readonly string[]): string[] {
  const offered = labels.map((label) => label.trim()).filter((label) => label && !/^selecciona/i.test(label));
  const folded = offered.map(foldLabel);
  const allowed = FREE_ADJUSTMENT_TYPES.map(foldLabel);
  const problems: string[] = [];
  offered.forEach((label, index) => {
    const key = folded[index] ?? "";
    if (/devoluci/.test(key)) problems.push(`el ajuste libre ofrece «${label}» (devolución sin documento ligado)`);
    else if (!allowed.includes(key)) problems.push(`tipo inesperado «${label}»`);
  });
  for (const label of FREE_ADJUSTMENT_TYPES) {
    if (!folded.includes(foldLabel(label))) problems.push(`falta «${label}»`);
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Peticiones POST /api/sales observadas en el navegador
// ---------------------------------------------------------------------------

export type SalePostSummary = {
  requests: number;
  clientRequestIds: string[];
  distinctClientRequestIds: number;
  withoutClientRequestId: number;
};

/** Resume los cuerpos (JSON en texto) de los POST /api/sales que salieron del navegador. */
export function summarizeSalePosts(bodies: readonly (string | null | undefined)[]): SalePostSummary {
  const ids: string[] = [];
  let missing = 0;
  for (const body of bodies) {
    let id: unknown;
    try {
      id = body ? (JSON.parse(body) as { clientRequestId?: unknown }).clientRequestId : undefined;
    } catch {
      id = undefined;
    }
    if (typeof id === "string" && id) ids.push(id);
    else missing += 1;
  }
  return {
    requests: bodies.length,
    clientRequestIds: ids,
    distinctClientRequestIds: new Set(ids).size,
    withoutClientRequestId: missing,
  };
}

// ---------------------------------------------------------------------------
// Excel de importación de productos
// ---------------------------------------------------------------------------

/** Mismas columnas y orden que `PRODUCT_IMPORT_HEADERS` de la app. */
export const IMPORT_HEADERS = [
  "sku",
  "codigo_barras",
  "nombre",
  "categoria",
  "precio_ref",
  "costo_ref",
  "stock_inicial",
  "stock_minimo",
] as const;

export const IMPORT_SHEET_NAME = "Productos";

export type ImportRow = {
  sku: string;
  nombre: string;
  categoria: string;
  precio_ref: number;
  costo_ref: number;
  stock_inicial: number;
  stock_minimo: number;
};

/** `count` filas con SKU `<skuPrefix>X<n>` y stock inicial 7, 14, 21… (todos > 0 y distintos). */
export function buildImportRows(skuPrefix: string, namePrefix: string, category: string, count = 3): ImportRow[] {
  if (!Number.isInteger(count) || count < 1) throw new Error("buildImportRows: count debe ser un entero ≥ 1.");
  const rows: ImportRow[] = [];
  for (let i = 1; i <= count; i += 1) {
    rows.push({
      sku: `${skuPrefix}X${i}`.toLowerCase(),
      nombre: `${namePrefix} Import ${i}`,
      categoria: category,
      precio_ref: 1 + i * 0.25,
      costo_ref: 0.5 + i * 0.1,
      stock_inicial: i * 7,
      stock_minimo: 1,
    });
  }
  return rows;
}

/**
 * Matriz de la hoja `Productos`: fila 1 encabezados, fila 2 ejemplo (la app la
 * ignora: los datos empiezan en la fila 3), después una fila por producto.
 */
export function buildImportSheetAoa(rows: readonly ImportRow[]): (string | number)[][] {
  const example: (string | number)[] = ["bod-ej-001", "", "Producto ejemplo", "", 1.5, 0.8, 0, 5];
  return [
    [...IMPORT_HEADERS],
    example,
    ...rows.map((row) => [
      row.sku,
      "",
      row.nombre,
      row.categoria,
      Number(row.precio_ref.toFixed(2)),
      Number(row.costo_ref.toFixed(2)),
      row.stock_inicial,
      row.stock_minimo,
    ]),
  ];
}

// ---------------------------------------------------------------------------
// Compras en modo empaque
// ---------------------------------------------------------------------------

/** Unidades que debe ingresar una línea en modo empaque. */
export function packUnits(packCount: number, unitsPerPack: number): number {
  if (!Number.isInteger(packCount) || !Number.isInteger(unitsPerPack) || packCount < 1 || unitsPerPack < 1) {
    throw new Error("packUnits: packCount y unitsPerPack deben ser enteros ≥ 1.");
  }
  return packCount * unitsPerPack;
}
