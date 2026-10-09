import { z } from "zod";

import { formatRefUsd } from "@/shared/utils/currency";

import type { PosCartItem } from "../hooks/usePosCart";

/**
 * Carrito recuperable del POS (CNF-16): lo que se guarda en `localStorage` para
 * devolverlo al volver a `/sales/create` o al reabrir el navegador.
 *
 * Se guarda: las líneas (producto, nombre, cantidad y el precio que se veía), el
 * cliente elegido, la sesión de caja y la fecha del guardado. El carrito del POS
 * no modela empaques ni descuentos (`PosCartItem`), así que no hay más que guardar.
 * NUNCA se guardan datos del cobro (método, montos, referencias) ni la clave de
 * idempotencia, que sigue viviendo en `utils/saleAttempt.ts`.
 *
 * El precio guardado NO se usa para vender: al restaurar manda el del catálogo
 * (`restorePosCartDraft`) y el guardado solo sirve para avisar de que cambió.
 *
 * Clave: tienda + usuario + caja + PESTAÑA. Dos pestañas con el mismo POS escriben
 * cada una en la suya, así que no se pisan ni se mezclan. Una pestaña sin carrito
 * propio (nueva, o el navegador reabierto) recoge el carrito guardado más reciente
 * de esa caja (`findPosCartDraft`) y lo pasa a su clave.
 * Límites de esta elección:
 * - No se sabe si la pestaña que guardó un carrito sigue abierta: si se abre el POS
 *   en una segunda pestaña con la primera a medias, la segunda muestra ese mismo
 *   carrito (con el aviso «Carrito recuperado» y «Vaciar»). Desde ahí cada una
 *   guarda el suyo; la primera vuelve a escribir el suyo en cuanto ve que se lo
 *   llevaron, así que tampoco lo pierde al recargar.
 * - Si quedan varios carritos de pestañas cerradas, cada entrada al POS con el
 *   carrito vacío recupera uno, del más reciente al más antiguo.
 *
 * Un carrito de otra sesión de caja no se restaura nunca: se borra al leerlo y al
 * detectar la caja cerrada o vencida (`purgePosCartDrafts`).
 * Para extender el esquema: campos OPCIONALES; un cambio incompatible sube
 * `POS_CART_DRAFT_VERSION` (y con ella la clave) y los guardados viejos se borran.
 */
export const POS_CART_DRAFT_VERSION = 1;

const KEY_FAMILY = "bodegahub:pos:carrito";
const KEY_PREFIX = `${KEY_FAMILY}:v${POS_CART_DRAFT_VERSION}`;
const TAB_ID_STORAGE_KEY = `${KEY_FAMILY}:pestana`;

export type PosCartDraftScope = {
  cashSessionId: string;
  registerId: string;
  storeId: string | null;
  userId: string;
};

type PosCartDraftOwner = Pick<PosCartDraftScope, "storeId" | "userId">;

const lineSchema = z.object({
  productId: z.string().min(1),
  productName: z.string(),
  quantity: z.number().positive(),
  unitPriceRef: z.number().nonnegative(),
});

const storedPosCartDraftSchema = z.object({
  cashSessionId: z.string().min(1),
  customerId: z.string(),
  lines: z.array(lineSchema).min(1),
  registerId: z.string().min(1),
  /** ISO 8601. */
  savedAt: z.string().refine((value) => !Number.isNaN(Date.parse(value))),
  storeId: z.string().nullable(),
  userId: z.string().min(1),
  version: z.literal(POS_CART_DRAFT_VERSION),
});

/** Lo que queda escrito en `localStorage`. */
export type StoredPosCartDraft = z.infer<typeof storedPosCartDraftSchema>;

/** Lo que aporta la pantalla; la sesión, la versión y la fecha las pone quien guarda. */
export type PosCartDraftContent = {
  customerId: string;
  items: PosCartItem[];
};

function ownerSegments({ storeId, userId }: PosCartDraftOwner) {
  return `${encodeURIComponent(storeId ?? "")}:${encodeURIComponent(userId)}`;
}

function scopePrefix(scope: PosCartDraftScope) {
  return `${KEY_PREFIX}:${ownerSegments(scope)}:${encodeURIComponent(scope.registerId)}:`;
}

/** Clave por tienda, usuario, caja y pestaña: un cajero no hereda el carrito de otro ni el de otra caja. */
export function posCartDraftStorageKey(scope: PosCartDraftScope, tabId: string) {
  return `${scopePrefix(scope)}${encodeURIComponent(tabId)}`;
}

// Respaldo si `sessionStorage` no está disponible: el id dura lo que la carga de página.
let memoryTabId: string | null = null;

function createTabId() {
  const id = crypto.randomUUID();

  memoryTabId = id;

  try {
    window.sessionStorage.setItem(TAB_ID_STORAGE_KEY, id);
  } catch {
    // Sin `sessionStorage` queda el respaldo en memoria.
  }

  return id;
}

/** Identificador de esta pestaña (sobrevive a recargar; no a cerrar la pestaña). */
export function readPosCartTabId() {
  try {
    const stored = window.sessionStorage.getItem(TAB_ID_STORAGE_KEY);

    if (stored) {
      return stored;
    }
  } catch {
    if (memoryTabId) {
      return memoryTabId;
    }
  }

  return createTabId();
}

/** Estrena identificador: otra pestaña comparte el actual (pestaña duplicada). */
export function rotatePosCartTabId() {
  return createTabId();
}

export function serializePosCartDraft(
  content: PosCartDraftContent,
  scope: PosCartDraftScope,
  savedAt: Date,
) {
  const draft: StoredPosCartDraft = {
    cashSessionId: scope.cashSessionId,
    customerId: content.customerId,
    lines: content.items.map((item) => ({
      productId: item.productId,
      productName: item.productName,
      quantity: item.quantity,
      unitPriceRef: item.unitPriceRef,
    })),
    registerId: scope.registerId,
    savedAt: savedAt.toISOString(),
    storeId: scope.storeId,
    userId: scope.userId,
    version: POS_CART_DRAFT_VERSION,
  };

  return JSON.stringify(draft);
}

/**
 * Lee un carrito guardado. Devuelve `null`, sin avisar, si no hay nada, si el texto
 * está corrupto, si es de otra versión o si lo guardó otra tienda, otro usuario,
 * otra caja u otra sesión de caja.
 */
export function parseStoredPosCartDraft(
  raw: string | null,
  scope: PosCartDraftScope,
): StoredPosCartDraft | null {
  if (!raw) {
    return null;
  }

  let value: unknown;

  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  const parsed = storedPosCartDraftSchema.safeParse(value);

  if (!parsed.success) {
    return null;
  }

  const draft = parsed.data;

  return draft.storeId === scope.storeId &&
    draft.userId === scope.userId &&
    draft.registerId === scope.registerId &&
    draft.cashSessionId === scope.cashSessionId
    ? draft
    : null;
}

/** Claves de `localStorage` que cumplen `matches`. Sin `localStorage`, ninguna. */
function listStorageKeys(matches: (key: string) => boolean) {
  const keys: string[] = [];

  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);

      if (key !== null && matches(key)) {
        keys.push(key);
      }
    }
  } catch {
    return [];
  }

  return keys;
}

/** `false` si `localStorage` no dejó escribir (bloqueado o lleno). */
export function writePosCartDraft(key: string, raw: string) {
  try {
    window.localStorage.setItem(key, raw);
    return true;
  } catch {
    return false;
  }
}

export function removePosCartDraft(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Sin `localStorage` no hay nada que borrar.
  }
}

export type FoundPosCartDraft = {
  draft: StoredPosCartDraft;
  /** Clave donde está: la de esta pestaña o la de otra (carrito huérfano). */
  key: string;
};

/**
 * Carrito que le toca a esta pestaña: el suyo y, si no tiene, el más reciente de
 * los guardados para la misma tienda, usuario, caja y sesión de caja. Solo lee.
 */
export function findPosCartDraft(scope: PosCartDraftScope, tabId: string): FoundPosCartDraft | null {
  const ownKey = posCartDraftStorageKey(scope, tabId);
  const prefix = scopePrefix(scope);
  let found: FoundPosCartDraft | null = null;

  try {
    const own = parseStoredPosCartDraft(window.localStorage.getItem(ownKey), scope);

    if (own) {
      return { draft: own, key: ownKey };
    }

    for (const key of listStorageKeys((candidate) => candidate.startsWith(prefix))) {
      const draft = parseStoredPosCartDraft(window.localStorage.getItem(key), scope);

      if (draft && (!found || Date.parse(draft.savedAt) > Date.parse(found.draft.savedAt))) {
        found = { draft, key };
      }
    }
  } catch {
    return null;
  }

  return found;
}

/** Clave de un carrito de ese usuario en esa tienda (y, si se pide, en esa caja), de cualquier versión. */
function isDraftKeyOf(key: string, owner: PosCartDraftOwner, registerId?: string) {
  const [family, area, kind, version, storeSegment, userSegment, registerSegment] = key.split(":");

  return (
    `${family}:${area}:${kind}` === KEY_FAMILY &&
    /^v\d+$/.test(version ?? "") &&
    `${storeSegment}:${userSegment}` === ownerSegments(owner) &&
    (registerId === undefined || registerSegment === encodeURIComponent(registerId))
  );
}

/**
 * Borra lo que ya no se puede restaurar en esta caja: guardados corruptos, de otra
 * sesión de caja o de una versión anterior del esquema.
 */
export function prunePosCartDrafts(scope: PosCartDraftScope) {
  const prefix = scopePrefix(scope);

  for (const key of listStorageKeys((candidate) =>
    isDraftKeyOf(candidate, scope, scope.registerId),
  )) {
    let raw: string | null = null;

    try {
      raw = window.localStorage.getItem(key);
    } catch {
      return;
    }

    if (!key.startsWith(prefix) || !parseStoredPosCartDraft(raw, scope)) {
      removePosCartDraft(key);
    }
  }
}

/** Caja cerrada o vencida: se borran todos los carritos guardados del usuario en la tienda. */
export function purgePosCartDrafts(owner: PosCartDraftOwner) {
  for (const key of listStorageKeys((candidate) => isDraftKeyOf(candidate, owner))) {
    removePosCartDraft(key);
  }
}

type CatalogProduct = {
  currentStock: number;
  id: string;
  imageUrl?: string | null;
  name: string;
  salePriceRef: number;
};

export type PosCartRestoration = {
  /** Cliente guardado, si sigue en la lista; `null` deja el que tenga la pantalla. */
  customerId: string | null;
  /** El cliente guardado ya no está entre los clientes del POS. */
  customerMissing: boolean;
  /** Líneas ya revalidadas: nombre, precio y existencia son los del catálogo actual. */
  items: PosCartItem[];
  /** Nombres de los productos guardados que ya no se venden (desactivados o borrados). */
  removed: string[];
  /** Productos cuyo precio cambió desde que se guardó el carrito. */
  repriced: Array<{ fromRef: number; name: string; toRef: number }>;
};

/**
 * Revalida un carrito guardado contra el catálogo ACTUAL (solo productos activos):
 * lo que ya no está se quita y el precio es siempre el del catálogo, nunca el
 * guardado. La cantidad se conserva: la existencia se valida al cobrar, como siempre.
 */
export function restorePosCartDraft(
  draft: StoredPosCartDraft,
  catalog: { customerIds: ReadonlySet<string>; products: readonly CatalogProduct[] },
): PosCartRestoration {
  const productsById = new Map(catalog.products.map((product) => [product.id, product]));
  const restoration: PosCartRestoration = {
    customerId: null,
    customerMissing: false,
    items: [],
    removed: [],
    repriced: [],
  };

  for (const line of draft.lines) {
    const product = productsById.get(line.productId);

    if (!product) {
      restoration.removed.push(line.productName || "Producto sin nombre");
      continue;
    }

    if (product.salePriceRef !== line.unitPriceRef) {
      restoration.repriced.push({
        fromRef: line.unitPriceRef,
        name: product.name,
        toRef: product.salePriceRef,
      });
    }

    restoration.items.push({
      imageUrl: product.imageUrl ?? undefined,
      productId: product.id,
      productName: product.name,
      quantity: line.quantity,
      stock: Math.max(product.currentStock, 0),
      unitPriceRef: product.salePriceRef,
    });
  }

  if (draft.customerId) {
    if (catalog.customerIds.has(draft.customerId)) {
      restoration.customerId = draft.customerId;
    } else {
      restoration.customerMissing = true;
    }
  }

  return restoration;
}

/** Hay algo que el cajero debe leer con calma: el aviso no se cierra solo. */
export function posCartRestorationHasChanges(restoration: PosCartRestoration) {
  return (
    restoration.removed.length > 0 ||
    restoration.repriced.length > 0 ||
    restoration.customerMissing
  );
}

/** Texto del aviso «Carrito recuperado»: qué volvió y qué cambió respecto a lo guardado. */
export function describePosCartRestoration(restoration: PosCartRestoration) {
  const count = restoration.items.length;
  const parts = [
    count === 0
      ? "Ningún producto del carrito guardado sigue a la venta."
      : count === 1
        ? "Volvió 1 producto de la venta que quedó a medias."
        : `Volvieron ${count} productos de la venta que quedó a medias.`,
  ];

  if (restoration.removed.length > 0) {
    parts.push(`Ya no se venden y se quitaron: ${restoration.removed.join(", ")}.`);
  }

  if (restoration.repriced.length > 0) {
    parts.push(
      `Precio actualizado: ${restoration.repriced
        .map((change) => `${change.name} ${formatRefUsd(change.fromRef)} → ${formatRefUsd(change.toRef)}`)
        .join("; ")}.`,
    );
  }

  if (restoration.customerMissing) {
    parts.push("El cliente guardado ya no está disponible: revisa el cliente.");
  }

  return parts.join(" ");
}

type SaleProcessLabelInput = {
  customerName?: string | null;
  lineCount: number;
  totalRef: number;
};

/**
 * Nombre de la venta en curso para el guardia de salida (CNF-15, regla 14):
 * "Venta en curso · 3 productos · REF 12,50 · Cliente mostrador".
 */
export function describeSaleInProgress({ customerName, lineCount, totalRef }: SaleProcessLabelInput) {
  const parts = [
    "Venta en curso",
    lineCount === 1 ? "1 producto" : `${lineCount} productos`,
    formatRefUsd(totalRef),
  ];
  const customer = customerName?.trim();

  if (customer) {
    parts.push(customer);
  }

  return parts.join(" · ");
}
