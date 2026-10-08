import { ApiError } from "@/lib/api/apiError";
import { assertSupabaseStoreResource } from "@/lib/api/assertStoreResource";
import { parsePagination } from "@/lib/api/pagination";
import { mapContact, type DbContactRow } from "@/lib/supabase/mappers/contacts";
import {
  mapPayment,
  mapPurchase,
  mapPurchaseItem,
  mapStockMovement,
  type DbPaymentRow,
  type DbPurchaseItemRow,
  type DbPurchaseRow,
  type DbStockMovementRow,
} from "@/lib/supabase/mappers/transactions";
import { throwIfSupabaseError } from "@/lib/supabase/errors";
import { applyCreatedAtCaracasRange } from "@/shared/utils/caracasBusinessDay";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import {
  isMissingRpcSignatureError,
  rpcWithClientRequestId,
} from "@/modules/inventory/services/rpcWithClientRequestId";
import { isRangeNotSatisfiable, listCountOptions } from "@/modules/products/services/listRange";
import type { PurchaseStatus } from "@/shared/mocks/erp-data";
import { roundMoney } from "@/shared/utils/currency";

import {
  getPurchasePendingRef,
  hasPendingBalance,
  PAYABLE_PURCHASE_STATUSES,
} from "../purchases-list/utils/purchaseBalance";
import type { PurchaseItemInput } from "../schemas/purchaseItem.schema";
import { normalizePurchaseLine, toRpcPurchaseItem } from "../schemas/purchaseItem.schema";
import {
  toRpcDisassembleList,
  type PurchaseLineRecipe,
  type ReceivePurchaseOptions,
} from "./purchaseDisassemble";
import type { PurchaseDetailAccess, PurchaseInput } from "./purchases.mock-server";

const contactSelect =
  "id, name, type, email, phone, address, tax_id, notes, is_active, created_at, updated_at";

const productSelect =
  "id, name, sku, category_id, current_cost_ref, current_stock, min_stock, image_url, is_active, sale_price_ref";

const purchaseSelect = `
  id,
  purchase_number,
  supplier_id,
  user_id,
  ref_rate_ves,
  subtotal_ref,
  subtotal_ves,
  discount_ref,
  discount_ves,
  tax_ref,
  tax_ves,
  total_ref,
  total_ves,
  paid_ves,
  paid_ref,
  status,
  notes,
  created_at,
  updated_at,
  supplier:contacts(${contactSelect}),
  purchase_items(count)
`;

const purchaseDetailSelect = `
  id,
  purchase_number,
  supplier_id,
  user_id,
  ref_rate_ves,
  subtotal_ref,
  subtotal_ves,
  discount_ref,
  discount_ves,
  tax_ref,
  tax_ves,
  total_ref,
  total_ves,
  paid_ves,
  paid_ref,
  status,
  notes,
  created_at,
  updated_at,
  supplier:contacts(${contactSelect}),
  purchase_items(
    id,
    disassemble_on_receive,
    disassembled_conversion_id,
    product_id,
    purchase_id,
    quantity,
    unit_cost_ref,
    unit_cost_ves,
    subtotal_ref,
    subtotal_ves,
    entry_mode,
    pack_label,
    pack_count,
    units_per_pack,
    pack_cost_ref,
    pack_cost_ves,
    tax_rate,
    tax_rate_code,
    tax_ref,
    tax_ves,
    cost_currency,
    product:products(${productSelect})
  )
`;

const paymentSelect = `
  id,
  direction,
  sale_id,
  purchase_id,
  contact_id,
  method,
  currency,
  amount,
  amount_ves,
  amount_ref,
  ref_rate_ves,
  bank_name,
  reference_code,
  created_at,
  contact:contacts(${contactSelect})
`;

type PurchaseListRow = DbPurchaseRow & {
  purchase_items?: Array<{ count: number }>;
  supplier?: DbContactRow | null;
};

type PurchaseDetailItemRow = DbPurchaseItemRow & {
  disassemble_on_receive?: boolean | null;
  disassembled_conversion_id?: string | null;
  id?: string;
  tax_rate_code?: string | null;
};

/** Receta activa de un empaque con el stock actual de sus componentes. */
const lineRecipeSelect = `
  id,
  pack_product_id,
  total_units,
  components:product_pack_components(
    unit_product_id,
    units_per_pack,
    unit_product:products!unit_product_id(name, current_stock, is_active)
  )
`;

type LineRecipeProductRow = { current_stock: number; is_active: boolean; name: string };

type LineRecipeRow = {
  components?: Array<{
    unit_product?: LineRecipeProductRow | LineRecipeProductRow[] | null;
    unit_product_id: string;
    units_per_pack: number;
  }> | null;
  id: string;
  pack_product_id: string;
  total_units: number;
};

function mapLineRecipe(row: LineRecipeRow): PurchaseLineRecipe {
  return {
    components: (row.components ?? [])
      .map((component) => {
        const product = Array.isArray(component.unit_product)
          ? component.unit_product[0]
          : component.unit_product;

        return {
          currentStock: product?.current_stock ?? 0,
          isActive: product?.is_active !== false,
          name: product?.name ?? component.unit_product_id,
          unitProductId: component.unit_product_id,
          unitsPerPack: component.units_per_pack,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "es") || (a.unitProductId < b.unitProductId ? -1 : 1)),
    conversionId: row.id,
    totalUnits: row.total_units,
  };
}

/**
 * COM-14 · recetas activas de los productos de un PEDIDO, por id de empaque: es lo
 * que la confirmación de recepción necesita para previsualizar el desarme. Una
 * sola consulta por compra; una compra ya recibida no la hace.
 */
async function loadLineRecipes(
  supabase: Awaited<ReturnType<typeof createRouteSupabaseClient>>,
  purchase: PurchaseDetailRow,
  storeId: string,
) {
  const productIds = [...new Set((purchase.purchase_items ?? []).map((item) => item.product_id))];

  if (purchase.status !== "pedido" || productIds.length === 0) {
    return new Map<string, PurchaseLineRecipe>();
  }

  const { data, error } = await supabase
    .from("product_pack_conversions")
    .select(lineRecipeSelect)
    .eq("store_id", storeId)
    .eq("is_active", true)
    .in("pack_product_id", productIds);

  throwIfSupabaseError(error);

  return new Map(
    ((data ?? []) as unknown as LineRecipeRow[]).map((row) => [row.pack_product_id, mapLineRecipe(row)]),
  );
}

type PurchaseDetailRow = DbPurchaseRow & {
  purchase_items?: PurchaseDetailItemRow[];
  supplier?: DbContactRow | null;
};

/**
 * Linea con el `code` de su alicuota de IVA (`taxRate` es el porcentaje congelado)
 * y lo del desarme al recibir (COM-14): su id, la marca, si ya se desarmo y, en un
 * pedido, la receta activa de su producto.
 */
function mapPurchaseDetailItem(
  row: PurchaseDetailItemRow,
  recipes: ReadonlyMap<string, PurchaseLineRecipe>,
) {
  const packRecipe = recipes.get(row.product_id);

  return {
    ...mapPurchaseItem(row),
    disassembled: Boolean(row.disassembled_conversion_id),
    disassembleOnReceive: row.disassemble_on_receive === true,
    id: row.id,
    ...(packRecipe ? { packRecipe } : {}),
    taxRateCode: row.tax_rate_code ?? undefined,
  };
}

function toRpcItems(items: NonNullable<PurchaseInput["items"]>) {
  return items.map((item) => toRpcPurchaseItem(item as PurchaseItemInput));
}

function applyPurchaseFilters<
  T extends {
    eq: (col: string, val: string) => T;
    gte: (col: string, val: string) => T;
    ilike: (col: string, val: string) => T;
    lt: (col: string, val: string) => T;
    lte: (col: string, val: string) => T;
  },
>(
  query: T,
  searchParams: URLSearchParams,
) {
  const from = searchParams.get("from");
  const search = searchParams.get("search")?.trim();
  const status = searchParams.get("status");
  const supplierId = searchParams.get("supplierId");
  const to = searchParams.get("to");

  let filteredQuery = query;

  if (search) {
    filteredQuery = filteredQuery.ilike("purchase_number", `%${search}%`);
  }

  if (status) {
    filteredQuery = filteredQuery.eq("status", status);
  }

  if (supplierId) {
    filteredQuery = filteredQuery.eq("supplier_id", supplierId);
  }

  filteredQuery = applyCreatedAtCaracasRange(filteredQuery, from, to);

  return filteredQuery;
}

function mapPurchaseListRow(row: PurchaseListRow) {
  return {
    ...mapPurchase(row),
    itemsCount: row.purchase_items?.[0]?.count ?? 0,
    supplier: row.supplier ? mapContact(row.supplier) : undefined,
  };
}

type PurchasesListResult = {
  items: ReturnType<typeof mapPurchaseListRow>[];
  limit: number;
  /** Solo con `pendingBalance=1`: suma del saldo de todas las compras filtradas. */
  pendingBalanceRef?: number;
  skip: number;
  total: number;
};

/** Filas por consulta al recorrer las compras vigentes (tope de filas de PostgREST). */
const BALANCE_SCAN_PAGE_SIZE = 1000;

type PurchaseBalanceRow = {
  id: string;
  paid_ref: number | string | null;
  status: string;
  total_ref: number | string | null;
};

/**
 * `pendingBalance=1`: compras vigentes con saldo. PostgREST no compara dos
 * columnas (`total_ref` contra `paid_ref`), así que se recorren las cabeceras
 * vigentes que cumplen los demás filtros (solo id e importes), el saldo se
 * decide aquí con la regla de `purchaseBalance` y se pide la página pedida por
 * id. Lo pagado es el de la cabecera (`purchases.paid_ref`): nunca se leen
 * filas de `payments`, así que vale igual para roles sin permiso sobre pagos.
 * De paso sale la suma del saldo de todo el filtro (`pendingBalanceRef`).
 */
async function listPurchasesWithPendingBalance(
  supabase: Awaited<ReturnType<typeof createRouteSupabaseClient>>,
  searchParams: URLSearchParams,
  storeId: string,
  { limit, skip }: { limit: number; skip: number },
): Promise<PurchasesListResult> {
  const pending: { id: string; pendingRef: number }[] = [];

  for (let offset = 0; ; offset += BALANCE_SCAN_PAGE_SIZE) {
    const scan = supabase
      .from("purchases")
      .select("id, total_ref, paid_ref, status")
      .eq("store_id", storeId)
      .in("status", [...PAYABLE_PURCHASE_STATUSES])
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });

    const { data, error } = await applyPurchaseFilters(scan, searchParams).range(
      offset,
      offset + BALANCE_SCAN_PAGE_SIZE - 1,
    );

    throwIfSupabaseError(error);

    const rows = (data ?? []) as PurchaseBalanceRow[];

    for (const row of rows) {
      const amounts = {
        paidRef: Number(row.paid_ref ?? 0),
        status: row.status,
        totalRef: Number(row.total_ref ?? 0),
      };

      if (hasPendingBalance(amounts)) {
        pending.push({ id: row.id, pendingRef: getPurchasePendingRef(amounts) });
      }
    }

    if (rows.length < BALANCE_SCAN_PAGE_SIZE) {
      break;
    }
  }

  const pageIds = pending.slice(skip, skip + limit).map((row) => row.id);
  const summary = {
    limit,
    pendingBalanceRef: roundMoney(pending.reduce((sum, row) => sum + row.pendingRef, 0)),
    skip,
    total: pending.length,
  };

  if (pageIds.length === 0) {
    return { ...summary, items: [] };
  }

  const { data, error } = await supabase
    .from("purchases")
    .select(purchaseSelect)
    .eq("store_id", storeId)
    .in("id", pageIds);

  throwIfSupabaseError(error);

  const items = (data ?? []).map((row) => mapPurchaseListRow(row as unknown as PurchaseListRow));

  return {
    ...summary,
    // `in` no garantiza orden: se respeta el del recorrido (más reciente primero).
    items: items.sort((a, b) => pageIds.indexOf(a.id) - pageIds.indexOf(b.id)),
  };
}

/**
 * Filtros: `search`, `status`, `supplierId`, `from` / `to` (día operativo
 * Caracas) y `pendingBalance=1` (solo compras vigentes con saldo; añade
 * `pendingBalanceRef`, la suma del saldo de todo el filtro).
 */
export async function listPurchases(
  searchParams: URLSearchParams,
  storeId: string,
): Promise<PurchasesListResult> {
  const supabase = await createRouteSupabaseClient();
  const { limit, skip } = parsePagination(searchParams);

  if (searchParams.get("pendingBalance") === "1") {
    return listPurchasesWithPendingBalance(supabase, searchParams, storeId, { limit, skip });
  }

  /** La consulta con todos los filtros; `head` = solo el conteo, sin filas. */
  const buildFilteredQuery = (head: boolean) => {
    const query = supabase
      .from("purchases")
      .select(purchaseSelect, listCountOptions(head))
      .eq("store_id", storeId);

    return applyPurchaseFilters(query, searchParams);
  };

  const { count, data, error, status } = await buildFilteredQuery(false)
    .order("created_at", { ascending: false })
    .range(skip, skip + limit - 1);

  // Página más allá del total: no es un error, es una página vacía con el total real.
  if (isRangeNotSatisfiable(error, status)) {
    const total = await buildFilteredQuery(true);

    throwIfSupabaseError(total.error);

    return { items: [], limit, skip, total: total.count ?? 0 };
  }

  throwIfSupabaseError(error);

  return {
    items: (data ?? []).map((row) => mapPurchaseListRow(row as unknown as PurchaseListRow)),
    limit,
    skip,
    total: count ?? 0,
  };
}

/**
 * Sin permiso para ver pagos de compras (almacén) no se consulta `payments`
 * (su RLS tampoco se los daría: parche 20261010c): el detalle lleva
 * `payments: []` y Pagado sale de la cabecera (`purchases.paid_ref` /
 * `paid_ves`, que mantiene `register_payment`).
 */
export async function getPurchaseById(
  id: string,
  storeId: string,
  access: PurchaseDetailAccess = { canViewPayments: true },
) {
  await assertSupabaseStoreResource("purchases", id, storeId, "Compra no encontrada.");
  const supabase = await createRouteSupabaseClient();

  const { data, error } = await supabase
    .from("purchases")
    .select(purchaseDetailSelect)
    .eq("id", id)
    .maybeSingle<PurchaseDetailRow>();

  throwIfSupabaseError(error);

  if (!data) {
    throw new ApiError(404, "NOT_FOUND", "Compra no encontrada.");
  }

  const recipes = await loadLineRecipes(supabase, data, storeId);

  if (!access.canViewPayments) {
    return {
      ...mapPurchase(data),
      items: (data.purchase_items ?? []).map((item) => mapPurchaseDetailItem(item, recipes)),
      payments: [],
      supplier: data.supplier ? mapContact(data.supplier) : undefined,
    };
  }

  const { data: payments, error: paymentsError } = await supabase
    .from("payments")
    .select(paymentSelect)
    .eq("purchase_id", id)
    .order("created_at", { ascending: false });

  throwIfSupabaseError(paymentsError);

  const mappedPayments = (payments ?? []).map((payment) => {
    const row = payment as unknown as DbPaymentRow & {
      contact?: DbContactRow | DbContactRow[] | null;
    };
    const contact = Array.isArray(row.contact) ? row.contact[0] : row.contact;

    return {
      ...mapPayment(row),
      contact: contact ? mapContact(contact) : undefined,
    };
  });

  const activePayments = mappedPayments.filter((payment) => payment.status !== "anulado");
  const paidRefFromPayments =
    Math.round(
      activePayments.reduce((sum, payment) => {
        if (payment.amountRef > 0) {
          return sum + payment.amountRef;
        }

        if (payment.refRateVes > 0 && payment.amountVes > 0) {
          return sum + payment.amountVes / payment.refRateVes;
        }

        return sum;
      }, 0) * 100,
    ) / 100;
  const paidVesFromPayments =
    Math.round(activePayments.reduce((sum, payment) => sum + payment.amountVes, 0) * 100) / 100;

  const mappedPurchase = mapPurchase(data);

  return {
    ...mappedPurchase,
    // Prefer sums from payment history so the status card stays in sync with the table.
    paidRef: paidRefFromPayments,
    paidVes: paidVesFromPayments,
    items: (data.purchase_items ?? []).map((item) => mapPurchaseDetailItem(item, recipes)),
    payments: mappedPayments,
    supplier: data.supplier ? mapContact(data.supplier) : undefined,
  };
}

export async function createPurchase(input: PurchaseInput, _storeId: string) {
  const supabase = await createRouteSupabaseClient();

  const { data, error } = await rpcWithClientRequestId(
    supabase,
    "create_purchase",
    {
      p_discount_ref: input.discountRef ?? 0,
      p_discount_ves: input.discountVes ?? null,
      p_exchange_rate_id: input.exchangeRateId ?? null,
      p_items: toRpcItems(input.items ?? []),
      p_notes: input.notes ?? null,
      p_purchase_number: input.purchaseNumber ?? null,
      p_ref_rate_ves: input.refRateVes ?? null,
      p_status: (input.status ?? "recibido") as PurchaseStatus,
      p_subtotal_ref: input.subtotalRef ?? null,
      p_subtotal_ves: input.subtotalVes ?? null,
      p_supplier_id: input.supplierId,
      p_tax_ref: input.taxRef ?? 0,
      p_tax_ves: input.taxVes ?? null,
    },
    input.clientRequestId,
  );

  throwIfSupabaseError(error);

  if (!data) {
    throw new ApiError(500, "INTERNAL_ERROR", "No se pudo crear la compra.");
  }

  return mapPurchase(data as DbPurchaseRow);
}

/**
 * Recibe un pedido y, en la misma transacción, abre los empaques de las líneas
 * marcadas «Desarmar al recibir» (COM-14, `receive_purchase_and_disassemble`).
 * - Sin `disassemble`: manda la marca guardada en cada línea y su receta.
 * - Con `disassemble`: la lista es el conjunto de líneas a desarmar; cada una
 *   puede traer su reparto real.
 * - `clientRequestId`: repetir la misma recepción devuelve la compra ya recibida.
 * Si algo falla la base lo revierte todo: no queda la compra recibida a medias.
 *
 * Degradación: si la base aún no tiene la RPC (`PGRST202`, no ejecutó nada) y no
 * se pidió desarmar ninguna línea, se recibe con `receive_purchase` como siempre.
 */
export async function receivePurchase(
  id: string,
  storeId: string,
  options: ReceivePurchaseOptions = {},
) {
  await assertSupabaseStoreResource("purchases", id, storeId, "Compra no encontrada.");
  const supabase = await createRouteSupabaseClient();
  const disassemble = options.disassemble;

  let { data, error } = await supabase.rpc("receive_purchase_and_disassemble", {
    p_purchase_id: id,
    // Solo viajan cuando se enviaron: sin ellos la llamada es la mínima.
    ...(disassemble ? { p_disassemble: toRpcDisassembleList(disassemble) } : {}),
    ...(options.clientRequestId ? { p_client_request_id: options.clientRequestId } : {}),
  });

  if (isMissingRpcSignatureError(error)) {
    if (disassemble && disassemble.length > 0) {
      throw new ApiError(
        409,
        "CONFLICT",
        "Esta base aún no admite desarmar al recibir. No se recibió la compra.",
      );
    }

    console.warn(
      "[stock] receive_purchase_and_disassemble no existe: la compra se recibe con receive_purchase (falta el parche 20261010d).",
    );
    ({ data, error } = await supabase.rpc("receive_purchase", { p_purchase_id: id }));
  }

  throwIfSupabaseError(error);

  if (!data) {
    throw new ApiError(404, "NOT_FOUND", "Compra no encontrada.");
  }

  return getPurchaseById(id, storeId);
}

export async function cancelPurchase(id: string, storeId: string) {
  await assertSupabaseStoreResource("purchases", id, storeId, "Compra no encontrada.");
  const supabase = await createRouteSupabaseClient();

  const { data, error } = await supabase.rpc("cancel_purchase", {
    p_purchase_id: id,
  });

  throwIfSupabaseError(error);

  if (!data) {
    throw new ApiError(404, "NOT_FOUND", "Compra no encontrada.");
  }

  return getPurchaseById(id, storeId);
}

export async function returnPurchase(id: string, storeId: string) {
  await assertSupabaseStoreResource("purchases", id, storeId, "Compra no encontrada.");
  const supabase = await createRouteSupabaseClient();

  const { data, error } = await supabase.rpc("return_purchase", {
    p_purchase_id: id,
  });

  throwIfSupabaseError(error);

  if (!data) {
    throw new ApiError(404, "NOT_FOUND", "Compra no encontrada.");
  }

  const purchase = await getPurchaseById(id, storeId);

  const { data: stockMovements, error: movementsError } = await supabase
    .from("stock_movements")
    .select("id, product_id, purchase_id, type, quantity_delta, reason, created_at")
    .eq("purchase_id", id)
    .eq("type", "devolucion_proveedor")
    .order("created_at", { ascending: false });

  throwIfSupabaseError(movementsError);

  return {
    purchase,
    stockMovements: (stockMovements ?? []).map((movement) =>
      mapStockMovement(movement as DbStockMovementRow),
    ),
  };
}
