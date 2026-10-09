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
 * Identidad (CNF-F5): cada carrito lleva un `cartId` que nace con su primer guardado y
 * se conserva al pasar de una pestaña a otra, así que todas sus copias lo comparten. Al
 * cobrarlo en cualquier pestaña, o al vaciarlo en la que lo creó (`settlePosCart`), se
 * borran TODAS sus copias de la caja y queda una marca con caducidad: una copia que otra
 * pestaña aún tenga en pantalla ni se vuelve a guardar ni se restaura, y esa pestaña avisa
 * (`usePosCartDraft`). Vaciar una COPIA solo borra la de esa pestaña (CNF-F8).
 *
 * Cobro (CNF-F8): la copia de un carrito ya cobrado no se cobra, y mientras una pestaña
 * cobra un carrito deja la marca «cobrando» (`beginPosCartCharge`) para que otra pestaña
 * con una copia no lo cobre a la vez. Solo los carritos guardados tienen identidad: una
 * venta que se cobra antes de su primer guardado no tiene copias y no lee ni escribe nada.
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
// Fuera de la familia `v<n>`: ni se lee como carrito ni lo borra `prunePosCartDrafts`.
const SETTLED_KEY_PREFIX = `${KEY_FAMILY}:cerrados`;

/** Lo que dura la marca de un carrito cobrado o vaciado: más que un turno de caja. */
export const POS_CART_SETTLED_TTL_MS = 12 * 60 * 60 * 1000;
/**
 * Lo que dura la marca «cobrando» si nadie la retira (la pestaña que cobraba se cerró o
 * su cobro quedó sin confirmar): más que un cobro lento, menos que la espera de un cliente.
 */
export const POS_CART_CHARGING_TTL_MS = 2 * 60 * 1000;
/** Marcas que se conservan como mucho: las más recientes. */
export const POS_CART_SETTLED_MAX = 200;

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
  /** Identidad del carrito, común a todas sus copias. Falta en lo guardado antes de CNF-F5. */
  cartId: z.string().min(1).optional(),
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
  cartId?: string;
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
    ...(content.cartId ? { cartId: content.cartId } : {}),
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

/** Cómo terminó un carrito: de eso depende lo que se le dice a quien tenga una copia. */
export type PosCartSettledReason = "cobrado" | "vaciado";

/**
 * Marcas de los carritos de una caja, todas en UNA clave: las de cierre («cobrado»,
 * «vaciado») y la de un cobro en curso («cobrando»), que no cierra nada.
 */
const posCartMarksSchema = z.array(
  z.object({
    /** Milisegundos (`Date.now()`) en que se cobró, se vació o se empezó a cobrar. */
    at: z.number(),
    cartId: z.string().min(1),
    reason: z.enum(["cobrado", "vaciado", "cobrando"]),
    /** Solo en «cobrando»: la pestaña que está cobrando. */
    tabId: z.string().optional(),
  }),
);

type PosCartMark = z.infer<typeof posCartMarksSchema>[number];
type SettledPosCart = PosCartMark & { reason: PosCartSettledReason };

function isSettledMark(mark: PosCartMark): mark is SettledPosCart {
  return mark.reason !== "cobrando";
}

/** Clave de las marcas de carritos cobrados o vaciados de esa tienda, usuario y caja. */
export function posCartSettledStorageKey(scope: PosCartDraftScope) {
  return `${SETTLED_KEY_PREFIX}:${ownerSegments(scope)}:${encodeURIComponent(scope.registerId)}`;
}

/** Marcas vigentes a `now` (una lectura). Sin `localStorage`, o con contenido ilegible, ninguna. */
function readPosCartMarks(scope: PosCartDraftScope, now: number): PosCartMark[] {
  let value: unknown;

  try {
    value = JSON.parse(window.localStorage.getItem(posCartSettledStorageKey(scope)) ?? "[]");
  } catch {
    return [];
  }

  const parsed = posCartMarksSchema.safeParse(value);

  return parsed.success
    ? parsed.data.filter(
        (entry) =>
          now - entry.at <
          (entry.reason === "cobrando" ? POS_CART_CHARGING_TTL_MS : POS_CART_SETTLED_TTL_MS),
      )
    : [];
}

/** Guarda las marcas (una escritura). Sin `localStorage` no queda marca y el POS sigue igual. */
function writePosCartMarks(scope: PosCartDraftScope, marks: PosCartMark[]) {
  try {
    window.localStorage.setItem(
      posCartSettledStorageKey(scope),
      JSON.stringify(marks.slice(-POS_CART_SETTLED_MAX)),
    );
  } catch {
    // Bloqueado o lleno: sin marca, cada pestaña se comporta como si estuviera sola.
  }
}

/** Marcas de cierre vigentes a `now`: un cobro en curso no cierra el carrito. */
function readSettledPosCarts(scope: PosCartDraftScope, now: number): SettledPosCart[] {
  return readPosCartMarks(scope, now).filter(isSettledMark);
}

/** Si ese carrito ya se cobró o vació (en cualquier pestaña) y la marca sigue vigente, cómo. */
export function findSettledPosCart(
  scope: PosCartDraftScope,
  cartId: string,
  now = Date.now(),
): PosCartSettledReason | null {
  return readSettledPosCarts(scope, now).find((entry) => entry.cartId === cartId)?.reason ?? null;
}

/**
 * Cierra un carrito en TODAS las pestañas: deja la marca (antes que nada, para que una
 * copia viva no lo reescriba) y borra todas sus copias guardadas en esa caja.
 * Un carrito ya marcado como cobrado no pasa a «vaciado». La marca «cobrando» de ese
 * carrito se va con el cierre.
 */
export function settlePosCart(
  scope: PosCartDraftScope,
  cartId: string,
  reason: PosCartSettledReason,
  now = Date.now(),
) {
  const marks = readPosCartMarks(scope, now);
  const alreadyCharged = marks.some(
    (entry) => entry.cartId === cartId && entry.reason === "cobrado",
  );

  // Si no se puede marcar, al menos se borran las copias guardadas.
  writePosCartMarks(scope, [
    ...marks.filter((entry) => entry.cartId !== cartId),
    { at: now, cartId, reason: alreadyCharged ? "cobrado" : reason },
  ]);

  const prefix = scopePrefix(scope);

  for (const key of listStorageKeys((candidate) => candidate.startsWith(prefix))) {
    let raw: string | null = null;

    try {
      raw = window.localStorage.getItem(key);
    } catch {
      return;
    }

    if (parseStoredPosCartDraft(raw, scope)?.cartId === cartId) {
      removePosCartDraft(key);
    }
  }
}

/** Si esta pestaña puede cobrar ese carrito: ya se cobró, o lo está cobrando otra. */
export type PosCartChargeGate = "cobrado" | "cobrando" | "libre";

/**
 * Justo antes de enviar el cobro de un carrito guardado (CNF-F8): UNA lectura y, si se
 * puede cobrar, UNA escritura. Si el carrito ya se cobró en otra pestaña, o si otra lo
 * está cobrando ahora, no se cobra aquí; si no, esta pestaña deja su marca «cobrando».
 * La misma pestaña puede repetir (reintento). Sin `localStorage` se cobra como siempre.
 *
 * Leer y escribir no es atómico entre pestañas: dos clics con milisegundos de diferencia
 * pueden pasar los dos. Esa ventana no se cierra desde `localStorage`.
 */
export function beginPosCartCharge(
  scope: PosCartDraftScope,
  cartId: string,
  tabId: string,
  now = Date.now(),
): PosCartChargeGate {
  const marks = readPosCartMarks(scope, now);
  const ofCart = marks.filter((entry) => entry.cartId === cartId);

  if (ofCart.some((entry) => entry.reason === "cobrado")) {
    return "cobrado";
  }

  if (ofCart.some((entry) => entry.reason === "cobrando" && entry.tabId !== tabId)) {
    return "cobrando";
  }

  writePosCartMarks(scope, [
    ...marks.filter((entry) => !(entry.cartId === cartId && entry.reason === "cobrando")),
    { at: now, cartId, reason: "cobrando", tabId },
  ]);

  return "libre";
}

/**
 * Retira la marca «cobrando» que puso esta pestaña: el servidor confirmó que ese cobro
 * no dejó venta. Un cobro registrado no pasa por aquí (`settlePosCart` la sustituye) y
 * uno sin confirmar tampoco: su marca caduca sola.
 */
export function endPosCartCharge(
  scope: PosCartDraftScope,
  cartId: string,
  tabId: string,
  now = Date.now(),
) {
  const marks = readPosCartMarks(scope, now);
  const isOwn = (entry: PosCartMark) =>
    entry.cartId === cartId && entry.reason === "cobrando" && entry.tabId === tabId;

  if (marks.some(isOwn)) {
    writePosCartMarks(
      scope,
      marks.filter((entry) => !isOwn(entry)),
    );
  }
}

export type FoundPosCartDraft = {
  draft: StoredPosCartDraft;
  /** Clave donde está: la de esta pestaña o la de otra (carrito huérfano). */
  key: string;
};

/**
 * Carrito que le toca a esta pestaña: el suyo y, si no tiene, el más reciente de
 * los guardados para la misma tienda, usuario, caja y sesión de caja. Una copia de un
 * carrito ya cobrado o vaciado no cuenta. Solo lee.
 */
export function findPosCartDraft(scope: PosCartDraftScope, tabId: string): FoundPosCartDraft | null {
  const ownKey = posCartDraftStorageKey(scope, tabId);
  const prefix = scopePrefix(scope);
  const settledIds = new Set(readSettledPosCarts(scope, Date.now()).map((entry) => entry.cartId));
  const readLive = (key: string) => {
    const draft = parseStoredPosCartDraft(window.localStorage.getItem(key), scope);

    return draft && !(draft.cartId && settledIds.has(draft.cartId)) ? draft : null;
  };
  let found: FoundPosCartDraft | null = null;

  try {
    const own = readLive(ownKey);

    if (own) {
      return { draft: own, key: ownKey };
    }

    for (const key of listStorageKeys((candidate) => candidate.startsWith(prefix))) {
      const draft = readLive(key);

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
 * sesión de caja, de una versión anterior del esquema o copias de un carrito ya cobrado
 * o vaciado.
 */
export function prunePosCartDrafts(scope: PosCartDraftScope) {
  const prefix = scopePrefix(scope);
  const settledIds = new Set(readSettledPosCarts(scope, Date.now()).map((entry) => entry.cartId));

  for (const key of listStorageKeys((candidate) =>
    isDraftKeyOf(candidate, scope, scope.registerId),
  )) {
    let raw: string | null = null;

    try {
      raw = window.localStorage.getItem(key);
    } catch {
      return;
    }

    const draft = key.startsWith(prefix) ? parseStoredPosCartDraft(raw, scope) : null;

    if (!draft || (draft.cartId && settledIds.has(draft.cartId))) {
      removePosCartDraft(key);
    }
  }
}

/**
 * Caja cerrada o vencida: se borran todos los carritos guardados del usuario en la tienda
 * y las marcas de los ya cobrados o vaciados.
 */
export function purgePosCartDrafts(owner: PosCartDraftOwner) {
  const settledPrefix = `${SETTLED_KEY_PREFIX}:${ownerSegments(owner)}:`;

  for (const key of listStorageKeys(
    (candidate) => isDraftKeyOf(candidate, owner) || candidate.startsWith(settledPrefix),
  )) {
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
  /** Líneas ya revalidadas: nombre, precio, existencia y tope de cantidad son los del catálogo actual. */
  items: PosCartItem[];
  /** Productos que siguen a la venta pero ya no tienen existencia: se quitaron. */
  outOfStock: string[];
  /** Nombres de los productos guardados que ya no se venden (desactivados o borrados). */
  removed: string[];
  /** Productos cuyo precio cambió desde que se guardó el carrito. */
  repriced: Array<{ fromRef: number; name: string; toRef: number }>;
  /** Líneas cuya cantidad se recortó a la existencia actual. */
  stockAdjusted: Array<{ from: number; name: string; to: number }>;
};

/**
 * Revalida un carrito guardado contra el catálogo ACTUAL (solo productos activos):
 * lo que ya no está se quita y el precio es siempre el del catálogo, nunca el
 * guardado. La cantidad lleva el mismo tope que al agregar a mano (`usePosCart`): una
 * línea por producto, como mucho la existencia actual, y sin existencia no entra (CNF-F8).
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
    outOfStock: [],
    removed: [],
    repriced: [],
    stockAdjusted: [],
  };
  // Una línea por producto, en el orden guardado: las repetidas suman antes del tope.
  const saved = new Map<
    string,
    { product: CatalogProduct; quantity: number; unitPriceRef: number }
  >();

  for (const line of draft.lines) {
    const product = productsById.get(line.productId);

    if (!product) {
      restoration.removed.push(line.productName || "Producto sin nombre");
      continue;
    }

    const repeated = saved.get(product.id);

    if (repeated) {
      repeated.quantity += line.quantity;
    } else {
      saved.set(product.id, { product, quantity: line.quantity, unitPriceRef: line.unitPriceRef });
    }
  }

  for (const { product, quantity: savedQuantity, unitPriceRef } of saved.values()) {
    const stock = Math.max(product.currentStock, 0);

    if (stock < 1) {
      restoration.outOfStock.push(product.name);
      continue;
    }

    const quantity = Math.min(stock, savedQuantity);

    if (quantity !== savedQuantity) {
      restoration.stockAdjusted.push({ from: savedQuantity, name: product.name, to: quantity });
    }

    if (product.salePriceRef !== unitPriceRef) {
      restoration.repriced.push({
        fromRef: unitPriceRef,
        name: product.name,
        toRef: product.salePriceRef,
      });
    }

    restoration.items.push({
      imageUrl: product.imageUrl ?? undefined,
      productId: product.id,
      productName: product.name,
      quantity,
      stock,
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
    restoration.outOfStock.length > 0 ||
    restoration.stockAdjusted.length > 0 ||
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

  if (restoration.outOfStock.length > 0) {
    parts.push(`Sin existencia, se quitaron: ${restoration.outOfStock.join(", ")}.`);
  }

  if (restoration.stockAdjusted.length > 0) {
    parts.push(
      `Cantidad ajustada a la existencia: ${restoration.stockAdjusted
        .map((change) => `${change.name} ${change.from} → ${change.to}`)
        .join("; ")}.`,
    );
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
