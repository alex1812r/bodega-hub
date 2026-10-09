import { z } from "zod";

import type { RestockLine, RestockSupplier } from "./restockPlan";

/**
 * Precarga de una compra de reposición (INV-05). La pantalla emisora la guarda
 * en `sessionStorage` y navega a `/purchases/create?restock=<id>`; la pantalla
 * de compra la lee con `readRestockDraft` y la borra con `clearRestockDraft`.
 * Contrato completo: `.notes/ux-mejoras/inventario/INV-05-contrato.md`.
 */

export const RESTOCK_DRAFT_VERSION = 1;
/** Clave de `sessionStorage`: `bodegahub:reposicion:v1:<id>`. */
export const RESTOCK_DRAFT_KEY_PREFIX = `bodegahub:reposicion:v${RESTOCK_DRAFT_VERSION}`;
/** Parámetro de `/purchases/create` que lleva el id de la precarga. */
export const RESTOCK_QUERY_PARAM = "restock";
/** Una precarga sin usar caduca a los 30 minutos de guardarse. */
export const RESTOCK_DRAFT_TTL_MS = 30 * 60 * 1000;
/** Líneas por precarga (una compra). */
export const RESTOCK_DRAFT_MAX_LINES = 200;

/** Mayor cantidad a pedir de un producto en una precarga. */
export const RESTOCK_DRAFT_MAX_QUANTITY = 999_999;
const RESTOCK_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

/** Quién guardó la precarga: otra tienda u otro usuario en la misma pestaña no la lee. */
export type RestockDraftSession = {
  storeId: string | null;
  userId: string;
};

/** Lo que viaja a la compra: un proveedor (o ninguno) y sus líneas. */
export type RestockDraftPayload = {
  lines: RestockLine[];
  /** Ausente = "Sin proveedor": la pantalla de compra lo pide antes de precargar. */
  supplier?: RestockSupplier;
};

export type RestockDraft = RestockDraftPayload & {
  /** Epoch ms en que se guardó. */
  createdAt: number;
  id: string;
};

export type RestockDraftReadResult =
  | { draft: RestockDraft; status: "ok" }
  /** `missing`: no existe o ya se usó. `invalid`: ilegible, de otra versión o de otra sesión. */
  | { status: "expired" | "invalid" | "missing" };

const supplierSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(300),
});

const lineSchema = z.object({
  currentStock: z.number().finite(),
  lastCostRef: z.number().finite().min(0).optional(),
  minStock: z.number().finite().min(0),
  name: z.string().min(1).max(300),
  productId: z.string().min(1).max(200),
  sku: z.string().max(200),
  suggestedQuantity: z.number().int().min(1).max(RESTOCK_DRAFT_MAX_QUANTITY),
});

const payloadSchema = z.object({
  lines: z
    .array(lineSchema)
    .min(1)
    .max(RESTOCK_DRAFT_MAX_LINES)
    .refine(
      (lines) => new Set(lines.map((line) => line.productId)).size === lines.length,
      "Un producto solo puede ir en una línea.",
    ),
  supplier: supplierSchema.optional(),
});

const storedSchema = payloadSchema.extend({
  createdAt: z.number().finite(),
  id: z.string().regex(RESTOCK_ID_PATTERN),
  session: z.object({ storeId: z.string().nullable(), userId: z.string().min(1) }),
  version: z.literal(RESTOCK_DRAFT_VERSION),
});

/** `null` en el servidor y donde el navegador no deja usar `sessionStorage`. */
function getStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function storageKey(id: string) {
  return `${RESTOCK_DRAFT_KEY_PREFIX}:${id}`;
}

function newRestockId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Borra las precargas anteriores (de cualquier versión): solo vive la última. */
function removeOtherDrafts(storage: Storage) {
  const stale: string[] = [];

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);

    if (key?.startsWith("bodegahub:reposicion:")) {
      stale.push(key);
    }
  }

  stale.forEach((key) => storage.removeItem(key));
}

/** `/purchases/create?restock=<id>`. */
export function buildRestockPurchaseHref(id: string) {
  return `/purchases/create?${RESTOCK_QUERY_PARAM}=${encodeURIComponent(id)}`;
}

/**
 * Guarda la precarga y devuelve su id, o `null` si no se pudo (sin sesión,
 * payload inválido, `sessionStorage` bloqueado o lleno). Reemplaza a cualquier
 * precarga anterior de la pestaña.
 */
export function saveRestockDraft(
  payload: RestockDraftPayload,
  session: RestockDraftSession | null | undefined,
  now: number = Date.now(),
): string | null {
  const storage = getStorage();
  const parsed = payloadSchema.safeParse(payload);

  if (storage === null || !session || !parsed.success) {
    return null;
  }

  const id = newRestockId();

  try {
    removeOtherDrafts(storage);
    storage.setItem(
      storageKey(id),
      JSON.stringify({
        ...parsed.data,
        createdAt: now,
        id,
        session: { storeId: session.storeId, userId: session.userId },
        version: RESTOCK_DRAFT_VERSION,
      }),
    );
  } catch {
    return null;
  }

  return id;
}

/**
 * Lee la precarga SIN borrarla (así una recarga de `/purchases/create` la vuelve
 * a encontrar). Lo que no se puede usar —caducado, ilegible, de otra versión o
 * de otra sesión— se borra al leerlo. Quien la aplica la borra con
 * `clearRestockDraft` cuando la compra se crea o se descarta.
 */
export function readRestockDraft(
  id: string | null | undefined,
  session: RestockDraftSession | null | undefined,
  now: number = Date.now(),
): RestockDraftReadResult {
  const storage = getStorage();

  if (storage === null || !id || !RESTOCK_ID_PATTERN.test(id)) {
    return { status: "missing" };
  }

  const key = storageKey(id);
  const raw = storage.getItem(key);

  if (raw === null) {
    return { status: "missing" };
  }

  // Sin sesión conocida (el usuario aún no cargó) no se decide nada: no se borra.
  if (!session) {
    return { status: "missing" };
  }

  let stored: z.infer<typeof storedSchema> | null = null;

  try {
    const parsed = storedSchema.safeParse(JSON.parse(raw));

    stored = parsed.success ? parsed.data : null;
  } catch {
    stored = null;
  }

  if (
    stored === null ||
    stored.id !== id ||
    stored.session.storeId !== session.storeId ||
    stored.session.userId !== session.userId
  ) {
    storage.removeItem(key);

    return { status: "invalid" };
  }

  // Un `createdAt` en el futuro (reloj cambiado) tampoco vale.
  if (now - stored.createdAt > RESTOCK_DRAFT_TTL_MS || stored.createdAt - now > RESTOCK_DRAFT_TTL_MS) {
    storage.removeItem(key);

    return { status: "expired" };
  }

  return {
    draft: {
      createdAt: stored.createdAt,
      id: stored.id,
      lines: stored.lines,
      ...(stored.supplier ? { supplier: stored.supplier } : {}),
    },
    status: "ok",
  };
}

/** Borra la precarga: ya se usó (compra creada) o el usuario la descartó. */
export function clearRestockDraft(id: string | null | undefined) {
  if (!id || !RESTOCK_ID_PATTERN.test(id)) {
    return;
  }

  getStorage()?.removeItem(storageKey(id));
}
