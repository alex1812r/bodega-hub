/**
 * SCN-06 · Hook del escaneo de facturas dentro de `POST /api/purchases`
 * (plan factura-escaneo-gtm §3 "Aprendizaje" y "Trazabilidad", §4, caos 6.10 y 6.14).
 *
 * Flujo, siempre con la tienda del servidor (`auth.storeId`), nunca la del cliente:
 * 1. `precheckInvoiceScan` ANTES de crear la compra RECLAMA el escaneo para el
 *    intento (`claim_invoice_scan`, un único UPDATE condicional; SCN-06-F1): de N
 *    intentos concurrentes con claves distintas solo uno pasa. Ajeno, inexistente,
 *    confirmado con otra compra, descartado, fallido o reclamado por otro intento
 *    vigente → 400 y la compra no se crea. Excepción (replay): si ya está
 *    `confirmed` con la compra que la tienda creó con el mismo `clientRequestId`,
 *    se deja pasar para que `create_purchase` devuelva la misma compra, y NO se
 *    vuelve a aprender. Con `invoiceScanId`, `clientRequestId` es obligatorio (la
 *    página de nueva compra siempre lo envía vía `useRequestAttempt`).
 *    Los rechazos del reclamo (PT404/PT409) se devuelven como 400, el contrato de
 *    caos 6.14; PT403 sigue siendo 403.
 * 2. Si `create_purchase` se RECHAZA (4xx, la compra no existe),
 *    `releaseInvoiceScanClaim` suelta el reclamo para reintentar con otra clave.
 *    Con resultado incierto (5xx, red) el reclamo se queda: caduca a los 5 min.
 * 3. `finalizeInvoiceScan` DESPUÉS de crear la compra: `confirm_invoice_scan` con el
 *    JSON confirmado (la verdad de la capa 2), exige el reclamo del mismo intento y,
 *    solo si confirmó en esta llamada (devuelve `true`), UNA llamada a
 *    `learn_invoice_aliases` (cada llamada suma `hits`). El alias sale del `rawText`
 *    GUARDADO en el escaneo (`normalizeAlias`), nunca del cliente; un alias de más
 *    de 200 caracteres no se aprende (nunca coincidiría exacto al recortarlo y la
 *    RPC rechazaría la llamada entera), pero sigue en el JSON confirmado.
 *    Nunca lanza: la compra ya existe; un fallo se registra en el log y se informa
 *    en `invoiceScan` de la respuesta. ÚNICA excepción (SCN-06-F2 · M1): si
 *    `confirm_invoice_scan` rechaza la compra porque no es de este intento (ya
 *    ligada a otro escaneo o de otra clave), `create_purchase` devolvió una compra
 *    VIEJA por idempotencia (también si se creó antes del reclamo, SCN-06-F3): se
 *    suelta el reclamo y se lanza 400.
 *    Solo se aprenden las líneas cuyo producto está en los items de la compra, y el
 *    empaque se toma del item (SCN-06-F2 · M3; ver `buildLearnLines`).
 */
import { normalizeAlias } from "@bodega/core/invoice";
import { z } from "zod";

import { ApiError } from "@/lib/api/apiError";
import { mapSupabaseError, throwIfSupabaseError } from "@/lib/supabase/errors";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

/** Máximo de líneas confirmadas por escaneo (mismo tope que `learn_invoice_aliases`). */
export const MAX_INVOICE_SCAN_LINES = 500;

/** Largo máximo de `alias_norm` que acepta `learn_invoice_aliases`. */
export const MAX_ALIAS_NORM_LENGTH = 200;

/** Largo máximo de `pack_label` que acepta `learn_invoice_aliases` (SCN-06-F4 · M-n1). */
export const MAX_PACK_LABEL_LENGTH = 100;

/** Vigencia del reclamo de un intento (mismo intervalo que `claim_invoice_scan`). */
export const INVOICE_SCAN_CLAIM_TTL_MS = 5 * 60 * 1000;

/**
 * Margen de reloj de `confirm_invoice_scan` (SCN-06-F3): una compra creada más de
 * este margen ANTES del reclamo es una compra vieja de la misma clave.
 */
export const INVOICE_SCAN_CLAIM_CLOCK_SKEW_MS = 1000;

export const invoiceScanLineInputSchema = z.object({
  /** Índice de la línea en `extraction.lines` del escaneo guardado. */
  lineIndex: z.number().int().min(0),
  productId: z.string().uuid(),
  packLabel: z.string().trim().max(100).nullable().optional(),
  unitsPerPack: z.number().int().positive().max(100000).nullable().optional(),
});

export type InvoiceScanLineInput = z.infer<typeof invoiceScanLineInputSchema>;

/**
 * Campos opcionales del cuerpo de `POST /api/purchases`. `invoiceScanLines` solo
 * tiene sentido con `invoiceScanId` (ver `addInvoiceScanBodyIssues`).
 */
export const invoiceScanBodyFields = {
  invoiceScanId: z.string().uuid().optional(),
  invoiceScanLines: z.array(invoiceScanLineInputSchema).max(MAX_INVOICE_SCAN_LINES).optional(),
};

export const invoiceScanBodySchema = z
  .object(invoiceScanBodyFields)
  .superRefine((value, context) => addInvoiceScanBodyIssues(value, context));

export function addInvoiceScanBodyIssues(
  value: { clientRequestId?: string; invoiceScanId?: string; invoiceScanLines?: InvoiceScanLineInput[] },
  context: z.RefinementCtx,
) {
  // El reclamo del escaneo es por intento: sin clave no hay replay ni reclamo seguro.
  if (value.invoiceScanId && !value.clientRequestId) {
    context.addIssue({
      code: "custom",
      message: "El escaneo requiere clientRequestId.",
      path: ["clientRequestId"],
    });
  }

  if (value.invoiceScanLines && !value.invoiceScanId) {
    context.addIssue({
      code: "custom",
      message: "Las líneas del escaneo requieren invoiceScanId.",
      path: ["invoiceScanLines"],
    });
  }
}

export const INVOICE_SCAN_NOT_FOUND_MESSAGE = "Escaneo no encontrado";
export const INVOICE_SCAN_ALREADY_CONFIRMED_MESSAGE = "El escaneo ya fue confirmado";
export const INVOICE_SCAN_UNAVAILABLE_MESSAGE = "El escaneo no está disponible";
export const INVOICE_SCAN_CLAIMED_MESSAGE = "El escaneo se está confirmando en otra compra";

/**
 * SCN-06-F2 · M1: la clave del intento ya creó otra compra (ligada a otro escaneo o
 * de otra clave). `create_purchase` devolvió esa compra vieja; el escaneo no se
 * confirma, se suelta su reclamo y la respuesta es 400 (no se creó nada nuevo).
 */
export const INVOICE_SCAN_KEY_REUSED_MESSAGE =
  "La clave de esta compra ya se usó en otra compra: la factura escaneada no se registró. Vuelve a guardarla como una compra nueva.";

/** Rechazos de `confirm_invoice_scan` que indican una compra que no es de este intento. */
const KEY_REUSE_REJECTIONS = new Set([
  "La compra ya está ligada a otro escaneo",
  "La compra no corresponde a este intento",
]);

export function isInvoiceScanKeyReuseRejection(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const { code, message } = error as { code?: unknown; message?: unknown };
  return code === "PT409" && typeof message === "string" && KEY_REUSE_REJECTIONS.has(message);
}

export type InvoiceScanStatus = "extracted" | "confirmed" | "discarded" | "failed";

/** Escaneo validado antes de crear la compra. */
export type PrecheckedInvoiceScan = {
  id: string;
  /** `rawText` de cada línea de `extracted.lines`, por índice (`null` si falta). */
  rawTexts: (string | null)[];
  /** `true`: reintento del mismo intento; ya confirmado con esta compra. */
  replay: boolean;
  purchaseId: string | null;
};

/** Resultado del hook que viaja en la respuesta como `invoiceScan`. */
export type InvoiceScanOutcome = {
  /** El escaneo quedó (o ya estaba, en replay) confirmado con esta compra. */
  confirmed: boolean;
  /** Alias aprendidos en esta llamada; `null` si no se aprendió (replay o fallo). */
  learned: number | null;
};

/**
 * Lo que el hook necesita de cada item de la compra (`purchaseItemInputSchema`): el
 * producto y, en modo empaque, `packLabel` y `unitsPerPack`.
 */
export type InvoiceScanPurchaseItem = {
  entryMode: "unit" | "pack";
  packLabel?: string;
  productId: string;
  unitsPerPack?: number;
};

export type FinalizeInvoiceScanInput = {
  clientRequestId?: string;
  /** Items de la compra creada: las líneas del escaneo se validan contra ellos (M3). */
  items: readonly InvoiceScanPurchaseItem[];
  lines: InvoiceScanLineInput[];
  purchaseId: string;
  supplierId: string;
};

export type ConfirmedInvoiceScanLine = InvoiceScanLineInput & {
  aliasNorm: string;
  rawText: string;
};

/** JSON guardado en `invoice_scans.confirmed` (verdad de la capa 2). */
export type ConfirmedInvoiceScan = {
  confirmedAt: string;
  lines: ConfirmedInvoiceScanLine[];
  purchaseId: string;
  supplierId: string;
};

/**
 * Línea para `learn_invoice_aliases`. Las claves de empaque viajan SIEMPRE salvo
 * cuando el empaque de la línea no coincide con el item: `null` = modo unidad (la
 * RPC borra el empaque del alias); sin clave = no se aprende el empaque (la RPC
 * conserva el que tenía).
 */
export type LearnAliasLine = {
  alias_norm: string;
  pack_label?: string | null;
  product_id: string;
  units_per_pack?: number | null;
};

/** `rawText` por índice desde `extracted` guardado; tolera un JSON incompleto. */
export function readExtractedRawTexts(extracted: unknown): (string | null)[] {
  const lines = (extracted as { lines?: unknown } | null)?.lines;

  if (!Array.isArray(lines)) {
    return [];
  }

  return lines.map((line) => {
    const rawText = (line as { rawText?: unknown } | null)?.rawText;
    return typeof rawText === "string" ? rawText : null;
  });
}

/**
 * Enriquecer las líneas del cliente con el texto guardado. Se omiten las que
 * apuntan fuera de `extracted.lines` (o a una línea sin `rawText`): no describen
 * ninguna línea de la factura.
 */
export function buildConfirmedLines(
  rawTexts: (string | null)[],
  lines: InvoiceScanLineInput[],
): ConfirmedInvoiceScanLine[] {
  return lines.flatMap((line) => {
    const rawText = rawTexts[line.lineIndex];

    if (typeof rawText !== "string") {
      return [];
    }

    return [{ ...line, aliasNorm: normalizeAlias(rawText), rawText }];
  });
}

/**
 * Líneas para `learn_invoice_aliases`: sin las que normalizan a "" ni las de más de
 * 200 caracteres (la RPC rechazaría la llamada entera; recortar daría un alias que
 * nunca coincide exacto con `normalizeAlias(rawText)`).
 */
export function buildLearnLines(
  confirmedLines: ConfirmedInvoiceScanLine[],
  items: readonly InvoiceScanPurchaseItem[],
): LearnAliasLine[] {
  return confirmedLines
    .filter(
      (line) =>
        line.aliasNorm !== "" &&
        Array.from(line.aliasNorm).length <= MAX_ALIAS_NORM_LENGTH &&
        items.some((item) => item.productId === line.productId),
    )
    .map((line) => ({
      alias_norm: line.aliasNorm,
      product_id: line.productId,
      ...resolveLearnPack(line, items),
    }));
}

/** Líneas cuyo producto no está en los items de la compra (no se aprenden; M3). */
export function countLinesOutsideItems(
  lines: readonly InvoiceScanLineInput[],
  items: readonly InvoiceScanPurchaseItem[],
): number {
  return lines.filter((line) => !items.some((item) => item.productId === line.productId)).length;
}

/**
 * Empaque a aprender, tomado del ITEM de la compra (SCN-06-F2 · M3):
 * - la línea dice `unitsPerPack` y hay un item en modo empaque del producto con ese
 *   mismo tamaño → `{ pack_label: item.packLabel, units_per_pack }`;
 * - la línea no dice empaque y el producto entra en modo unidad → claves en `null`
 *   (borra el empaque del alias; A1);
 * - cualquier otro caso (tamaño distinto del item, empaque sin item de empaque o
 *   unidad sin item de unidad) → sin claves: no se aprende el empaque.
 */
function resolveLearnPack(
  line: InvoiceScanLineInput,
  items: readonly InvoiceScanPurchaseItem[],
): Pick<LearnAliasLine, "pack_label" | "units_per_pack"> {
  const own = items.filter((item) => item.productId === line.productId);

  if (line.unitsPerPack != null) {
    const pack = own.find((item) => item.entryMode === "pack" && item.unitsPerPack === line.unitsPerPack);

    return pack
      ? { pack_label: toLearnPackLabel(pack.packLabel), units_per_pack: line.unitsPerPack }
      : {};
  }

  return own.some((item) => item.entryMode === "unit") ? { pack_label: null, units_per_pack: null } : {};
}

/**
 * Etiqueta del item para learn (SCN-06-F4 · M-n1): el schema de compra no limita
 * `packLabel`, pero la RPC rechaza la llamada ENTERA si pasa de 100 caracteres;
 * se recorta a 100 (code points, como `length` en SQL) para no perder el resto.
 */
function toLearnPackLabel(label: string | undefined): string | null {
  const trimmed = label?.trim() ?? "";
  return Array.from(trimmed).slice(0, MAX_PACK_LABEL_LENGTH).join("").trim() || null;
}

export function buildConfirmedPayload(
  rawTexts: (string | null)[],
  input: FinalizeInvoiceScanInput,
  now = new Date(),
): ConfirmedInvoiceScan {
  return {
    confirmedAt: now.toISOString(),
    lines: buildConfirmedLines(rawTexts, input.lines),
    purchaseId: input.purchaseId,
    supplierId: input.supplierId,
  };
}

/** Log sin datos de la factura: solo ids y el código/mensaje del rechazo. */
export function logInvoiceScanFailure(
  step: "confirm" | "learn" | "release",
  scanId: string,
  error: unknown,
) {
  const details =
    error && typeof error === "object"
      ? {
          code: (error as { code?: unknown }).code,
          message: (error as { message?: unknown }).message,
        }
      : { message: String(error) };

  console.error(`[invoice-scan] ${step} falló; la compra quedó creada`, { scanId, ...details });
}

/** Reglas comunes de server y mock tras leer el escaneo (sin tocar la base). */
export function assertScanUsable(
  scan: { status: string; purchaseId: string | null } | null,
  replayPurchaseId: string | null,
): { replay: boolean } {
  if (!scan) {
    throw new ApiError(400, "BAD_REQUEST", INVOICE_SCAN_NOT_FOUND_MESSAGE);
  }

  if (scan.status === "extracted") {
    return { replay: false };
  }

  if (scan.status === "confirmed") {
    if (replayPurchaseId && scan.purchaseId === replayPurchaseId) {
      return { replay: true };
    }

    throw new ApiError(400, "BAD_REQUEST", INVOICE_SCAN_ALREADY_CONFIRMED_MESSAGE);
  }

  throw new ApiError(400, "BAD_REQUEST", INVOICE_SCAN_UNAVAILABLE_MESSAGE);
}

type DbInvoiceScanRow = {
  extracted: unknown;
  id: string;
  purchase_id: string | null;
  status: string;
};

/** Clave del reclamo: el escaneo y el intento de compra que lo confirma. */
export type InvoiceScanClaimInput = { clientRequestId: string; scanId: string };

/**
 * Rechazos del reclamo en la respuesta: PT404 / PT409 → 400 (contrato de caos
 * 6.14, mismo código que el pre-check anterior); el resto (PT403, 5xx) tal cual.
 */
function toClaimRejection(error: unknown): ApiError {
  const mapped = mapSupabaseError(error);

  return mapped.status === 404 || mapped.status === 409
    ? new ApiError(400, "BAD_REQUEST", mapped.message)
    : mapped;
}

export async function precheckInvoiceScan(
  input: InvoiceScanClaimInput,
  storeId: string,
): Promise<PrecheckedInvoiceScan> {
  const supabase = await createRouteSupabaseClient();

  // Reclamo atómico ANTES de create_purchase (SCN-06-F1): la RPC filtra por la
  // tienda de la sesión y decide entre reclamado, replay o rechazo.
  const { data: claim, error: claimError } = await supabase.rpc("claim_invoice_scan", {
    p_client_request_id: input.clientRequestId,
    p_scan_id: input.scanId,
  });

  if (claimError) {
    throw toClaimRejection(claimError);
  }

  // Filtro explícito por tienda además de la RLS (caos 6.14).
  const { data, error } = await supabase
    .from("invoice_scans")
    .select("id, status, purchase_id, extracted")
    .eq("id", input.scanId)
    .eq("store_id", storeId)
    .maybeSingle();

  throwIfSupabaseError(error);

  const row = (data as DbInvoiceScanRow | null) ?? null;

  if (!row) {
    throw new ApiError(400, "BAD_REQUEST", INVOICE_SCAN_NOT_FOUND_MESSAGE);
  }

  return {
    id: row.id,
    purchaseId: row.purchase_id,
    rawTexts: readExtractedRawTexts(row.extracted),
    replay: claim === "replay",
  };
}

/**
 * Suelta el reclamo del intento tras un rechazo de `create_purchase`. Best effort:
 * nunca lanza (el error de la compra es el que viaja); si falla, el reclamo caduca.
 */
export async function releaseInvoiceScanClaim(
  input: InvoiceScanClaimInput,
  _storeId: string,
): Promise<void> {
  try {
    const supabase = await createRouteSupabaseClient();
    const { error } = await supabase.rpc("release_invoice_scan_claim", {
      p_client_request_id: input.clientRequestId,
      p_scan_id: input.scanId,
    });

    if (error) {
      logInvoiceScanFailure("release", input.scanId, error);
    }
  } catch (error) {
    logInvoiceScanFailure("release", input.scanId, error);
  }
}

export async function finalizeInvoiceScan(
  scan: PrecheckedInvoiceScan,
  input: FinalizeInvoiceScanInput,
  storeId: string,
): Promise<InvoiceScanOutcome> {
  if (scan.replay) {
    return { confirmed: scan.purchaseId === input.purchaseId, learned: null };
  }

  let supabase: Awaited<ReturnType<typeof createRouteSupabaseClient>>;

  try {
    supabase = await createRouteSupabaseClient();
  } catch (error) {
    logInvoiceScanFailure("confirm", scan.id, error);
    return { confirmed: false, learned: null };
  }

  const confirmed = buildConfirmedPayload(scan.rawTexts, input);
  let keyReused = false;

  try {
    const { data, error } = await supabase.rpc("confirm_invoice_scan", {
      p_client_request_id: input.clientRequestId ?? null,
      p_confirmed: confirmed,
      p_purchase_id: input.purchaseId,
      p_scan_id: scan.id,
    });

    if (error && isInvoiceScanKeyReuseRejection(error)) {
      keyReused = true;
    } else if (error) {
      logInvoiceScanFailure("confirm", scan.id, error);
      return { confirmed: false, learned: null };
    }

    // `false`: ya estaba confirmado con esta compra (otra llamada del mismo
    // intento); no se vuelve a aprender.
    if (data === false) {
      return { confirmed: true, learned: null };
    }
  } catch (error) {
    logInvoiceScanFailure("confirm", scan.id, error);
    return { confirmed: false, learned: null };
  }

  // M1: la compra devuelta no es de este intento (la clave ya creó otra compra);
  // no se creó nada nuevo, así que se suelta el reclamo y se rechaza la petición.
  if (keyReused) {
    if (input.clientRequestId) {
      await releaseInvoiceScanClaim({ clientRequestId: input.clientRequestId, scanId: scan.id }, storeId);
    }

    throw new ApiError(400, "BAD_REQUEST", INVOICE_SCAN_KEY_REUSED_MESSAGE);
  }

  const outside = countLinesOutsideItems(input.lines, input.items);

  if (outside > 0) {
    console.error("[invoice-scan] líneas del escaneo fuera de la compra; no se aprenden", {
      count: outside,
      scanId: scan.id,
    });
  }

  const learnLines = buildLearnLines(confirmed.lines, input.items);

  try {
    // UNA sola llamada por confirmación: cada llamada suma hits. Se hace aunque no
    // haya líneas (SCN-06-F4 · M-n2): fija `learned_at` y cierra el aprendizaje del
    // escaneo, para que nadie lo use después por PostgREST.
    const { data, error } = await supabase.rpc("learn_invoice_aliases", {
      p_lines: learnLines,
      p_scan_id: scan.id,
    });

    if (error) {
      logInvoiceScanFailure("learn", scan.id, error);
      return { confirmed: true, learned: null };
    }

    return { confirmed: true, learned: typeof data === "number" ? data : Number(data ?? 0) };
  } catch (error) {
    logInvoiceScanFailure("learn", scan.id, error);
    return { confirmed: true, learned: null };
  }
}
