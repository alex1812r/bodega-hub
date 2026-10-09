/**
 * Efecto de recibir (`receive_purchase_and_disassemble`), cancelar
 * (`cancel_purchase`) o devolver (`return_purchase`) una compra, calculado SIN
 * escribir (CNF-14). Función pura: el cargador real (`purchaseImpact.server.ts`)
 * y el del mock (`purchaseImpact.mock-server.ts`) solo leen y le pasan los
 * datos; el cálculo es el mismo en los dos.
 *
 * Reproduce, paso a paso y en su mismo orden, las versiones vigentes de
 * `receive_purchase_and_disassemble` (20261010d), `receive_purchase` (20261006c),
 * `convert_pack_to_units` (20261009d), `cancel_purchase` / `return_purchase`
 * (20261006f) y el trigger del libro de stock (20261006e). Detalle y citas:
 * `.notes/ux-mejoras/confirmaciones/CNF-14-diseno.md`, sección «Compra».
 *
 * Lo que conviene saber antes de pintarlo:
 * - Recibir fija en cada producto de la compra el ÚLTIMO costo de su línea con
 *   IVA (no un promedio); al desarmar, cada componente que recibe unidades queda
 *   con un promedio ponderado entre su stock y lo que le toca del empaque.
 * - Cancelar y devolver NO revierten dinero: con un pago activo la RPC rechaza
 *   la acción y pide anular antes los pagos. Tampoco revierten el costo que fijó
 *   la recepción (`costs` va vacío).
 */
import {
  firstInexact,
  fromCents,
  impactAllowed,
  impactRejected,
  toCents,
} from "@/shared/impact/impactVerdict";
import type {
  ImpactDocument,
  ImpactInexact,
  ImpactPaymentLine,
  ImpactStockLine,
  ImpactVerdict,
} from "@/shared/impact/types";
import type { PaymentMethod, PaymentStatus, PurchaseStatus } from "@/shared/mocks/erp-data";

import { missingRecipeOnReceiveMessage } from "./purchaseDisassemble";

export const PURCHASE_IMPACT_ACTIONS = ["receive", "cancel", "return"] as const;

export type PurchaseImpactAction = (typeof PURCHASE_IMPACT_ACTIONS)[number];

/** Una línea a desarmar tal como viaja en `PATCH /receive` (`disassemble[]`). */
export type PurchaseImpactDisassembleEntry = {
  distribution?: Array<{ unitProductId: string; units: number }>;
  purchaseItemId: string;
};

export type PurchaseImpactRecipe = {
  components: Array<{ costWeight: number; unitProductId: string; unitsPerPack: number }>;
  conversionId: string;
  packProductId: string;
  totalUnits: number;
};

export type PurchaseImpactInputs = {
  action: PurchaseImpactAction;
  /**
   * `false`: el rol no puede ver pagos de compras (almacén, D23). El veredicto
   * los cuenta igual que la RPC, pero `payments` sale vacío.
   */
  canViewPayments: boolean;
  /**
   * Solo `receive`. `null`: se desarman las líneas marcadas con el pedido
   * (`p_disassemble = null`). Lista: sustituye las marcas (`[]` = ninguna).
   */
  disassemble: PurchaseImpactDisassembleEntry[] | null;
  items: Array<{
    /** La recepción ya abrió sus empaques (`disassembled_conversion_id`). */
    disassembled: boolean;
    disassembleOnReceive: boolean;
    id: string;
    productId: string;
    /** Unidades normalizadas de la línea (`purchase_items.quantity`). */
    quantity: number;
    taxRate: number;
    /** Costo por unidad sin IVA (`purchase_items.unit_cost_ref`). */
    unitCostRef: number;
  }>;
  /** Pagos de la compra. Vacío en `receive`: recibir no los mira. */
  payments: Array<{
    amount: number;
    amountRef: number;
    amountVes: number;
    createdAt: string;
    currency: "USD" | "VES";
    id: string;
    method: PaymentMethod;
    status: PaymentStatus;
  }>;
  /** Productos de las líneas y de las recetas que existen en la tienda de la compra. */
  products: Array<{
    currentCostRef: number | null;
    currentStock: number;
    id: string;
    isActive: boolean;
    name: string;
    sku: string | null;
  }>;
  purchase: {
    id: string;
    purchaseNumber: string;
    status: PurchaseStatus;
    supplierName: string | null;
  };
  /** Recetas ACTIVAS de los productos de la compra (solo hacen falta en `receive`). */
  recipes: PurchaseImpactRecipe[];
  /** Unidades ya devueltas al proveedor por producto: −Σ `devolucion_proveedor` de la compra. */
  returnedByProduct: Record<string, number>;
};

/** Stock de un producto, con el desglose de lo que la recepción le hace. */
export type PurchaseImpactStockLine = ImpactStockLine & {
  /** `receive`: unidades que le entran como componente de empaques desarmados. */
  componentsIn: number;
  /** `receive`: empaques suyos que vuelven a salir al desarmarse. */
  disassembledOut: number;
  /** `receive`: unidades que entran por las líneas de la compra. */
  purchasedIn: number;
};

/** Costo (`products.current_cost_ref`, REF con IVA) que fija la recepción. */
export type PurchaseImpactCostLine = {
  costRefAfter: number | null;
  costRefBefore: number | null;
  inexact: ImpactInexact | null;
  isActive: boolean;
  productId: string;
  productName: string;
  sku: string | null;
  /**
   * `purchase_line`: último costo de su línea con IVA. `disassemble`: promedio
   * ponderado al recibir unidades de un empaque desarmado.
   */
  source: "disassemble" | "purchase_line";
};

/** Las dos caras de una línea que se desarma al recibir. */
export type PurchaseImpactDisassembleLine = {
  components: Array<{
    isActive: boolean;
    productId: string;
    productName: string;
    sku: string | null;
    stockAfter: number;
    /** Stock del componente antes de ESTA apertura (ya con lo anterior de la recepción). */
    stockBefore: number;
    unitsIn: number;
  }>;
  packProductId: string;
  packProductName: string;
  /** Empaques que salen: los mismos que entraron con la línea. */
  packsOut: number;
  purchaseItemId: string;
};

/** Producto por el que la RPC rechaza la acción. */
export type PurchaseImpactBlockingProduct = {
  /** Stock que tiene hoy; `null` si el producto ya no existe en la tienda. */
  available: number | null;
  productId: string;
  productName: string | null;
  /** Unidades que la acción necesita sacar; `null` si no aplica. */
  required: number | null;
  sku: string | null;
};

/** Respuesta de `GET /api/purchases/[id]/impact?action=receive|cancel|return`. */
export type PurchaseImpact = ImpactVerdict & {
  action: PurchaseImpactAction;
  /**
   * Con `allowed = false` por un producto (stock insuficiente, producto que ya
   * no existe): cuáles. En cancelar / devolver lista TODOS los que no alcanzan;
   * la RPC se detiene en el primero (orden de id). Vacío en el resto de casos.
   */
  blockingProducts: PurchaseImpactBlockingProduct[];
  /** Solo `receive` permitido; vacío en cancelar / devolver (no revierten el costo). */
  costs: PurchaseImpactCostLine[];
  /** Solo `receive` permitido: una entrada por línea que se desarma, en el orden de la RPC. */
  disassemble: PurchaseImpactDisassembleLine[];
  document: ImpactDocument<PurchaseStatus>;
  /** Resumen: primera parte que no se pudo calcular con exactitud. */
  inexact: ImpactInexact | null;
  /** Siempre sin `effects`: ninguna de las tres acciones mueve dinero. */
  payments: ImpactPaymentLine[];
  /** `true`: el rol no ve pagos de compras; `payments` va vacío aunque existan. */
  paymentsRestricted: boolean;
  /** `receive`: neto por producto. Cancelar / devolver: solo si la compra estaba recibida. */
  stock: PurchaseImpactStockLine[];
};

const MESSAGES = {
  alreadyClosed: "La compra ya fue cancelada o devuelta",
  distributionNotComponent: "Un producto de la distribucion no es componente de la receta del empaque",
  distributionRepeated: "La distribucion repite un componente de la receta",
  insufficientPack: "Stock insuficiente de empaque",
  insufficientToRevert: "No hay stock suficiente para revertir la compra",
  ledgerNegative: "Stock insuficiente",
  listForeignLine: "Una linea a desarmar no pertenece a la compra",
  listRepeatedLine: "La lista de lineas a desarmar repite una linea",
  receiveOnlyOrdered: "Solo se pueden recibir compras en estado pedido",
  recipeIncomplete:
    "La receta del empaque esta incompleta: sus componentes no suman las unidades del empaque",
  returnOnlyReceived: "Solo se pueden devolver compras recibidas",
  tooManyPacks: "La cantidad de empaques es demasiado grande",
  unitProductMissing: "Producto unidad no encontrado",
} as const;

const POSTGRES_INT_MAX = 2147483647;
const MISSING_PRODUCT_REASON = "El producto ya no existe en la tienda: no se puede leer su stock.";
const SEVERAL_NAMES_REASON =
  "El rechazo nombra varios productos: el orden de los nombres en el mensaje de la base puede ser otro.";
const COST_UNREADABLE_REASON =
  "No se pudo leer con exactitud el costo, el IVA o el peso de la receta: el costo resultante no se puede anticipar.";

type ProductInput = PurchaseImpactInputs["products"][number];
type ItemInput = PurchaseImpactInputs["items"][number];
type PaymentInput = PurchaseImpactInputs["payments"][number];

const big = (value: number) => BigInt(value);
const ZERO = big(0);
const TWO = big(2);

/** `value` como entero con `decimals` decimales; `null` si no cabe exacto. */
function scaled(value: number, decimals: number): bigint | null {
  if (!Number.isFinite(value)) {
    return null;
  }

  const text = value.toFixed(decimals);

  return Number(text) === value ? BigInt(text.replace(".", "")) : null;
}

/** `round(n / d)` de Postgres (numeric): la mitad se aleja de cero. `d > 0`. */
function roundDiv(numerator: bigint, divisor: bigint): bigint {
  const magnitude = numerator < ZERO ? -numerator : numerator;
  const quotient = (magnitude * TWO + divisor) / (divisor * TWO);

  return numerator < ZERO ? -quotient : quotient;
}

/** Orden de `uuid` en Postgres (por bytes) = orden del texto en minúsculas. */
function compareIds(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** `order by product_id, id` de las dos RPC de recepción. */
function byProductThenId(left: ItemInput, right: ItemInput) {
  return compareIds(left.productId, right.productId) || compareIds(left.id, right.id);
}

/** Orden de creación, solo para mostrar los pagos. */
function byCreation(left: PaymentInput, right: PaymentInput) {
  return left.createdAt === right.createdAt
    ? compareIds(left.id, right.id)
    : left.createdAt < right.createdAt
      ? -1
      : 1;
}

/** `round(numeric, 2)` dentro de un `format('%s')`: siempre dos decimales. */
function sqlMoney(cents: number) {
  return fromCents(cents).toFixed(2);
}

function missingStockLine(productId: string): PurchaseImpactStockLine {
  return {
    componentsIn: 0,
    disassembledOut: 0,
    inexact: { reason: MISSING_PRODUCT_REASON },
    isActive: null,
    productId,
    productName: null,
    purchasedIn: 0,
    quantityDelta: 0,
    sku: null,
    stockAfter: null,
    stockBefore: null,
  };
}

function idleStockLine(product: ProductInput): PurchaseImpactStockLine {
  return {
    componentsIn: 0,
    disassembledOut: 0,
    inexact: null,
    isActive: product.isActive,
    productId: product.id,
    productName: product.name,
    purchasedIn: 0,
    quantityDelta: 0,
    sku: product.sku,
    stockAfter: product.currentStock,
    stockBefore: product.currentStock,
  };
}

function blockingProduct(
  productId: string,
  product: ProductInput | undefined,
  required: number | null,
): PurchaseImpactBlockingProduct {
  return {
    available: product?.currentStock ?? null,
    productId,
    productName: product?.name ?? null,
    required,
    sku: product?.sku ?? null,
  };
}

/** Productos distintos, en el orden de su primera aparición. */
function distinct(ids: Iterable<string>) {
  return [...new Set(ids)];
}

type Parts = {
  blockingProducts?: PurchaseImpactBlockingProduct[];
  costs?: PurchaseImpactCostLine[];
  disassemble?: PurchaseImpactDisassembleLine[];
  notes?: ImpactInexact[];
  payments?: ImpactPaymentLine[];
  /** Líneas de stock ya proyectadas; con `allowed = false` se usan `idleStock`. */
  stock?: PurchaseImpactStockLine[];
};

const STATUS_AFTER: Record<PurchaseImpactAction, PurchaseStatus> = {
  cancel: "cancelado",
  receive: "recibido",
  return: "devuelto",
};

function assemble(inputs: PurchaseImpactInputs, verdict: ImpactVerdict, parts: Parts): PurchaseImpact {
  const { purchase } = inputs;
  const stock = parts.stock ?? [];
  const costs = verdict.allowed ? (parts.costs ?? []) : [];
  const payments = inputs.canViewPayments ? (parts.payments ?? []) : [];
  const notes = (parts.notes ?? []).map((inexact) => ({ inexact }));

  return {
    ...verdict,
    action: inputs.action,
    blockingProducts: verdict.allowed ? [] : (parts.blockingProducts ?? []),
    costs,
    disassemble: verdict.allowed ? (parts.disassemble ?? []) : [],
    document: {
      contactName: purchase.supplierName,
      id: purchase.id,
      number: purchase.purchaseNumber,
      status: purchase.status,
      statusAfter: verdict.allowed ? STATUS_AFTER[inputs.action] : purchase.status,
    },
    inexact: firstInexact([...notes, ...payments, ...stock, ...costs]),
    payments,
    paymentsRestricted: !inputs.canViewPayments,
    stock,
  };
}

// ---------------------------------------------------------------------------
// Recibir
// ---------------------------------------------------------------------------

type SimProduct = {
  componentsIn: number;
  /** Costo en céntimos; `null` = ya no se puede anticipar. */
  costCents: bigint | null;
  costSource: PurchaseImpactCostLine["source"] | null;
  disassembledOut: number;
  product: ProductInput;
  purchasedIn: number;
  stock: number;
};

class Rejection {
  constructor(
    readonly verdict: ImpactVerdict,
    readonly blocking: PurchaseImpactBlockingProduct[] = [],
    readonly notes: ImpactInexact[] = [],
  ) {}
}

/** Líneas que se desarman: la lista manda sobre la marca guardada con el pedido. */
function resolveMarked(inputs: PurchaseImpactInputs) {
  const { disassemble, items } = inputs;

  if (disassemble === null) {
    return new Map(
      items
        .filter((item) => item.disassembleOnReceive)
        .map((item) => [item.id, undefined as PurchaseImpactDisassembleEntry["distribution"]]),
    );
  }

  const itemIds = new Set(items.map((item) => item.id));
  const marked = new Map<string, PurchaseImpactDisassembleEntry["distribution"]>();

  for (const entry of disassemble) {
    if (marked.has(entry.purchaseItemId)) {
      throw new Rejection(impactRejected("BAD_REQUEST", MESSAGES.listRepeatedLine));
    }

    if (!itemIds.has(entry.purchaseItemId)) {
      throw new Rejection(impactRejected("BAD_REQUEST", MESSAGES.listForeignLine));
    }

    marked.set(entry.purchaseItemId, entry.distribution);
  }

  return marked;
}

/** Unidades por componente (en orden de id) de una apertura: el reparto enviado o la receta. */
function openingUnits(
  recipe: PurchaseImpactRecipe,
  componentIds: string[],
  packQuantity: number,
  distribution: PurchaseImpactDisassembleEntry["distribution"],
) {
  const recipeUnits = new Map(
    recipe.components.map((component) => [component.unitProductId, component.unitsPerPack]),
  );

  if (!distribution) {
    return componentIds.map((id) => (recipeUnits.get(id) ?? 0) * packQuantity);
  }

  const units = new Map<string, number>();
  let sent = 0;

  for (const entry of distribution) {
    if (!recipeUnits.has(entry.unitProductId)) {
      throw new Rejection(impactRejected("BAD_REQUEST", MESSAGES.distributionNotComponent));
    }

    if (units.has(entry.unitProductId)) {
      throw new Rejection(impactRejected("BAD_REQUEST", MESSAGES.distributionRepeated));
    }

    units.set(entry.unitProductId, entry.units);
    sent += entry.units;
  }

  const expected = recipe.totalUnits * packQuantity;

  if (sent !== expected) {
    throw new Rejection(
      impactRejected(
        "BAD_REQUEST",
        `La distribucion debe sumar ${expected} unidades (${packQuantity} empaques x ${recipe.totalUnits}) y suma ${sent}`,
      ),
    );
  }

  return componentIds.map((id) => units.get(id) ?? 0);
}

/**
 * Costo de los componentes tras una apertura (`convert_pack_to_units`): el valor
 * del empaque se reparte en proporción a unidades × peso, con 4 decimales; el de
 * mayor peso (si empatan, el de mayor id) se queda el residuo. Cada componente
 * queda con el promedio ponderado entre su stock y lo que recibe.
 */
function applyOpeningCosts(
  pack: SimProduct,
  packQuantity: number,
  components: Array<{ sim: SimProduct; units: number; weight: number }>,
) {
  const receiving = components.filter((component) => component.units > 0);
  const weights = receiving.map((component) => scaled(component.weight, 6));
  const readable = pack.costCents !== null && weights.every((weight) => weight !== null);
  // Valor transferido en diezmilésimas de REF: empaques × costo del empaque.
  const transferred = readable ? big(packQuantity) * (pack.costCents ?? ZERO) * big(100) : ZERO;
  const shares = receiving.map((component, index) => big(component.units) * (weights[index] ?? ZERO));
  const weightTotal = shares.reduce((total, share) => total + share, ZERO);
  let residual = 0;

  receiving.forEach((_, index) => {
    if (shares[index] >= shares[residual]) {
      residual = index;
    }
  });

  let allocated = ZERO;
  const values = receiving.map((_, index) => {
    if (index === residual || weightTotal === ZERO) {
      return ZERO;
    }

    const value = roundDiv(transferred * shares[index], weightTotal);
    allocated += value;

    return value;
  });

  if (receiving.length > 0) {
    values[residual] = transferred - allocated;
  }

  receiving.forEach(({ sim, units }, index) => {
    sim.costSource = "disassemble";

    if (!readable || weightTotal === ZERO || (sim.stock > 0 && sim.costCents === null)) {
      sim.costCents = null;

      return;
    }

    sim.costCents =
      sim.stock <= 0
        ? roundDiv(values[index], big(units) * big(100))
        : roundDiv(
            big(sim.stock) * (sim.costCents ?? ZERO) * big(100) + values[index],
            big(sim.stock + units) * big(100),
          );
  });
}

function simulateReceive(inputs: PurchaseImpactInputs, sims: Map<string, SimProduct>) {
  const marked = resolveMarked(inputs);
  const products = new Map(inputs.products.map((product) => [product.id, product]));
  const recipes = new Map(inputs.recipes.map((recipe) => [recipe.packProductId, recipe]));
  const markedItems = inputs.items.filter((item) => marked.has(item.id));

  // Líneas marcadas cuyo producto (de la tienda) no tiene receta activa.
  const withoutRecipe = distinct(markedItems.map((item) => item.productId))
    .flatMap((id) => {
      const product = products.get(id);

      return product && !recipes.has(id) ? [product] : [];
    })
    .sort((a, b) => a.name.localeCompare(b.name, "es") || compareIds(a.id, b.id));

  if (withoutRecipe.length > 0) {
    throw new Rejection(
      impactRejected(
        "CONFLICT",
        missingRecipeOnReceiveMessage(withoutRecipe.map((product) => product.name)),
      ),
      withoutRecipe.map((product) => blockingProduct(product.id, product, null)),
      // La base ordena los nombres con su propia colación.
      withoutRecipe.length > 1 ? [{ reason: SEVERAL_NAMES_REASON }] : [],
    );
  }

  // 1. `receive_purchase`: por línea, fija el costo y suma el stock.
  for (const item of [...inputs.items].sort(byProductThenId)) {
    const sim = sims.get(item.productId);

    if (!sim) {
      throw new Rejection(
        impactRejected("NOT_FOUND", `Producto no encontrado: ${item.productId}`),
        [blockingProduct(item.productId, undefined, null)],
      );
    }

    const costCents = scaled(item.unitCostRef, 2);
    const taxRate = scaled(item.taxRate, 4);
    const million = big(1_000_000);

    // round(unit_cost_ref * (1 + tax_rate / 100), 2)
    sim.costCents =
      costCents === null || taxRate === null
        ? null
        : roundDiv(costCents * (million + taxRate), million);
    sim.costSource = "purchase_line";
    sim.stock += item.quantity;
    sim.purchasedIn += item.quantity;

    if (sim.stock < 0) {
      throw new Rejection(impactRejected("CONFLICT", MESSAGES.ledgerNegative), [
        blockingProduct(item.productId, sim.product, null),
      ]);
    }
  }

  // 2. `purchase_disassemble_lines`: abre los empaques de cada línea marcada.
  const openings: PurchaseImpactDisassembleLine[] = [];

  for (const item of markedItems.filter((line) => !line.disassembled).sort(byProductThenId)) {
    const recipe = recipes.get(item.productId);
    const pack = sims.get(item.productId);

    if (!recipe || !pack) {
      continue;
    }

    const recipeTotal = recipe.components.reduce((total, part) => total + part.unitsPerPack, 0);

    if (recipe.components.length === 0 || recipeTotal !== recipe.totalUnits) {
      throw new Rejection(impactRejected("CONFLICT", MESSAGES.recipeIncomplete), [
        blockingProduct(pack.product.id, pack.product, null),
      ]);
    }

    const componentIds = recipe.components.map((part) => part.unitProductId).sort(compareIds);
    const units = openingUnits(recipe, componentIds, item.quantity, marked.get(item.id));
    const missing = componentIds.find((id) => !sims.has(id));

    if (missing) {
      throw new Rejection(impactRejected("NOT_FOUND", MESSAGES.unitProductMissing), [
        blockingProduct(missing, undefined, null),
      ]);
    }

    if (pack.stock < item.quantity) {
      throw new Rejection(impactRejected("CONFLICT", MESSAGES.insufficientPack), [
        { ...blockingProduct(pack.product.id, pack.product, item.quantity), available: pack.stock },
      ]);
    }

    if (recipe.totalUnits * item.quantity > POSTGRES_INT_MAX) {
      throw new Rejection(impactRejected("BAD_REQUEST", MESSAGES.tooManyPacks));
    }

    const weights = new Map(recipe.components.map((part) => [part.unitProductId, part.costWeight]));
    const components = componentIds.map((id, index) => ({
      sim: sims.get(id) as SimProduct,
      units: units[index],
      weight: weights.get(id) ?? 0,
    }));

    applyOpeningCosts(pack, item.quantity, components);
    pack.stock -= item.quantity;
    pack.disassembledOut += item.quantity;

    openings.push({
      components: components
        .filter((component) => component.units > 0)
        .map(({ sim, units: unitsIn }) => {
          const stockBefore = sim.stock;
          sim.stock += unitsIn;
          sim.componentsIn += unitsIn;

          if (sim.stock < 0) {
            throw new Rejection(impactRejected("CONFLICT", MESSAGES.ledgerNegative), [
              blockingProduct(sim.product.id, sim.product, null),
            ]);
          }

          return {
            isActive: sim.product.isActive,
            productId: sim.product.id,
            productName: sim.product.name,
            sku: sim.product.sku,
            stockAfter: sim.stock,
            stockBefore,
            unitsIn,
          };
        }),
      packProductId: pack.product.id,
      packProductName: pack.product.name,
      packsOut: item.quantity,
      purchaseItemId: item.id,
    });
  }

  return openings;
}

function computeReceive(inputs: PurchaseImpactInputs): PurchaseImpact {
  const products = new Map(inputs.products.map((product) => [product.id, product]));
  const purchasedIds = distinct(inputs.items.map((item) => item.productId));
  // Sin proyección: los productos de las líneas tal como están hoy.
  const idleStock = purchasedIds.map((id) => {
    const product = products.get(id);

    return product ? idleStockLine(product) : missingStockLine(id);
  });

  if (inputs.purchase.status !== "pedido") {
    return assemble(inputs, impactRejected("CONFLICT", MESSAGES.receiveOnlyOrdered), {
      stock: idleStock,
    });
  }

  const sims = new Map<string, SimProduct>(
    inputs.products.map((product) => [
      product.id,
      {
        componentsIn: 0,
        costCents: scaled(product.currentCostRef ?? 0, 2),
        costSource: null,
        disassembledOut: 0,
        product,
        purchasedIn: 0,
        stock: product.currentStock,
      },
    ]),
  );
  let openings: PurchaseImpactDisassembleLine[];

  try {
    openings = simulateReceive(inputs, sims);
  } catch (error) {
    if (error instanceof Rejection) {
      return assemble(inputs, error.verdict, {
        blockingProducts: error.blocking,
        notes: error.notes,
        stock: idleStock,
      });
    }

    throw error;
  }

  // Productos de la compra primero; después los componentes que solo reciben del desarme.
  const touched = distinct([
    ...purchasedIds,
    ...openings.flatMap((opening) => opening.components.map((component) => component.productId)),
  ]).flatMap((id) => {
    const sim = sims.get(id);

    return sim ? [sim] : [];
  });

  return assemble(inputs, impactAllowed(), {
    costs: touched.flatMap((sim): PurchaseImpactCostLine[] =>
      sim.costSource === null
        ? []
        : [
            {
              costRefAfter: sim.costCents === null ? null : Number(sim.costCents) / 100,
              costRefBefore: sim.product.currentCostRef,
              inexact: sim.costCents === null ? { reason: COST_UNREADABLE_REASON } : null,
              isActive: sim.product.isActive,
              productId: sim.product.id,
              productName: sim.product.name,
              sku: sim.product.sku,
              source: sim.costSource,
            },
          ],
    ),
    disassemble: openings,
    stock: touched.map((sim) => ({
      ...idleStockLine(sim.product),
      componentsIn: sim.componentsIn,
      disassembledOut: sim.disassembledOut,
      purchasedIn: sim.purchasedIn,
      quantityDelta: sim.stock - sim.product.currentStock,
      stockAfter: sim.stock,
    })),
  });
}

// ---------------------------------------------------------------------------
// Cancelar / devolver
// ---------------------------------------------------------------------------

function paymentLine(
  payment: PaymentInput,
  outcome: ImpactPaymentLine["outcome"],
  description: string,
): ImpactPaymentLine {
  return {
    amount: payment.amount,
    amountRef: payment.amountRef,
    amountVes: payment.amountVes,
    // Los pagos a proveedores no llevan vuelto.
    changeVes: 0,
    currency: payment.currency,
    description,
    effects: [],
    inexact: null,
    method: payment.method,
    netVes: payment.amountVes,
    outcome,
    paymentId: payment.id,
    status: payment.status,
    statusAfter: payment.status,
  };
}

const VERBS: Record<"cancel" | "return", { infinitive: string; imperative: string }> = {
  cancel: { imperative: "cancela", infinitive: "cancelar" },
  return: { imperative: "devuelve", infinitive: "devolver" },
};

/**
 * `cancel_purchase` / `return_purchase`: no tocan dinero. Guardas en su orden:
 * ya cancelada o devuelta → pagos activos → (devolver) no recibida → por
 * producto en orden de id, producto inexistente o stock insuficiente.
 */
function computeReversal(inputs: PurchaseImpactInputs, action: "cancel" | "return"): PurchaseImpact {
  const { purchase } = inputs;
  const verb = VERBS[action];
  const products = new Map(inputs.products.map((product) => [product.id, product]));
  const payments = [...inputs.payments].sort(byCreation);
  const active = payments.filter((payment) => payment.status === "activo");
  const closed = purchase.status === "cancelado" || purchase.status === "devuelto";
  let verdict = closed ? impactRejected("CONFLICT", MESSAGES.alreadyClosed) : impactAllowed();

  if (verdict.allowed && active.length > 0) {
    const activeCents = active.reduce((total, payment) => total + toCents(payment.amountVes), 0);

    verdict = impactRejected(
      "CONFLICT",
      `La compra ${purchase.purchaseNumber} tiene ${active.length} pago(s) activo(s) por Bs ${sqlMoney(activeCents)}. Anula primero los pagos y luego ${verb.imperative} la compra.`,
    );
  }

  if (verdict.allowed && action === "return" && purchase.status !== "recibido") {
    verdict = impactRejected("CONFLICT", MESSAGES.returnOnlyReceived);
  }

  const paymentLines = payments.map((payment) =>
    payment.status === "anulado"
      ? paymentLine(payment, "already_cancelled", "Ya estaba anulado: nada que revertir.")
      : closed
        ? paymentLine(payment, "unchanged", `No se toca: la compra no se puede ${verb.infinitive}.`)
        : paymentLine(
            payment,
            "blocks_action",
            `Sigue activo: hay que anularlo antes de ${verb.infinitive} la compra.`,
          ),
  );

  // Solo una compra recibida mueve stock (un pedido se cancela sin movimientos).
  if (purchase.status !== "recibido") {
    return assemble(inputs, verdict, { payments: paymentLines });
  }

  const received = new Map<string, number>();

  for (const item of inputs.items) {
    received.set(item.productId, (received.get(item.productId) ?? 0) + item.quantity);
  }

  const lines = new Map<string, PurchaseImpactStockLine>();
  const blocking: PurchaseImpactBlockingProduct[] = [];
  let stockVerdict: ImpactVerdict | null = null;

  // La RPC recorre `order by product_id` y se detiene en el primer fallo.
  for (const productId of [...received.keys()].sort(compareIds)) {
    const product = products.get(productId);

    if (!product) {
      lines.set(productId, missingStockLine(productId));
      blocking.push(blockingProduct(productId, undefined, null));
      stockVerdict ??= impactRejected(
        "NOT_FOUND",
        `Producto no encontrado en tu tienda (${productId}): no se puede revertir el stock de la compra ${purchase.purchaseNumber}`,
      );
      continue;
    }

    // C15 — lo ya devuelto al proveedor con movimientos ligados a esta compra.
    const pending = (received.get(productId) ?? 0) - (inputs.returnedByProduct[productId] ?? 0);
    const quantityOut = Math.max(pending, 0);

    if (quantityOut > 0 && product.currentStock - quantityOut < 0) {
      blocking.push(blockingProduct(productId, product, quantityOut));
      stockVerdict ??= impactRejected("CONFLICT", MESSAGES.insufficientToRevert);
    }

    lines.set(productId, {
      ...idleStockLine(product),
      quantityDelta: 0 - quantityOut,
      stockAfter: product.currentStock - quantityOut,
    });
  }

  if (verdict.allowed && stockVerdict) {
    verdict = stockVerdict;
  }

  const projected = verdict.allowed;

  return assemble(inputs, verdict, {
    // Solo si el rechazo es el del stock: con otro motivo la RPC no llegó a mirarlo.
    blockingProducts: verdict === stockVerdict ? blocking : [],
    payments: paymentLines,
    // En el orden de las líneas de la compra, como el resto del impact.
    stock: [...received.keys()].flatMap((productId) => {
      const line = lines.get(productId);

      if (!line) {
        return [];
      }

      return [projected ? line : { ...line, quantityDelta: 0, stockAfter: line.stockBefore }];
    }),
  });
}

export function computePurchaseImpact(inputs: PurchaseImpactInputs): PurchaseImpact {
  return inputs.action === "receive" ? computeReceive(inputs) : computeReversal(inputs, inputs.action);
}
