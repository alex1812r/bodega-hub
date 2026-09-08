import {
  getCaracasIsoDate,
  roundMoney,
  shiftIsoDate,
  type PaymentMethod,
  type UserRole,
} from "@bodega/core";

import { ApiError, type ApiErrorCode } from "@/lib/api/apiError";
import { getPaginationRange, toPaginatedList } from "@/lib/supabase/pagination";
import {
  getSupabaseErrorMessage,
  mapSupabaseError,
  throwIfSupabaseError,
} from "@/lib/supabase/errors";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { getGrossProfitReport } from "@/modules/reports/services/reports.server";

import type {
  PayrollCancelPaymentInput,
  PayrollCommissionSale,
  PayrollCurrentSummary,
  PayrollEmployee,
  PayrollEmployeeInput,
  PayrollEstimateRow,
  PayrollItem,
  PayrollMineCurrent,
  PayrollMineItem,
  PayrollPaidCurrency,
  PayrollPayInput,
  PayrollPeriod,
  PayrollPeriodDetail,
  PayrollPeriodStatus,
  PayrollSettings,
  PayrollSettingsInput,
  PayrollSettingsView,
} from "../types";
import {
  ownerBreakdown,
  sumItem,
  type PayrollCommissionKind,
} from "../utils/payrollMath";
import { redactPeriodForCashier } from "../utils/periodVisibility";
import {
  currentPeriodKey,
  parsePeriodKey,
  previousPeriodKey,
} from "../utils/quincena";

/**
 * Implementación Supabase de la nómina. Todo lo que escribe pasa por los RPC de
 * `supabase/patches/20260907-payroll.sql`, que resuelven la tienda con
 * `assert_store_context()` y exigen rol `admin`; el `storeId` del BFF solo se usa
 * para filtrar las lecturas por PostgREST.
 */

// -----------------------------------------------------------------------------
// Errores
// -----------------------------------------------------------------------------

/**
 * SQLSTATE deliberados de los RPC de nómina. La clase `PT` está reservada para
 * códigos de usuario y PostgREST la interpreta como el status HTTP, así que basta
 * con leer `error.code` (mismo patrón que `payments.server.ts`).
 */
const RPC_SQLSTATE_MAP: Record<string, { code: ApiErrorCode; status: number }> = {
  PT400: { code: "BAD_REQUEST", status: 400 },
  PT402: { code: "INSUFFICIENT_VAULT_BALANCE", status: 400 },
  PT403: { code: "FORBIDDEN", status: 403 },
  PT404: { code: "NOT_FOUND", status: 404 },
  PT409: { code: "CONFLICT", status: 409 },
};

function getSupabaseErrorSqlState(error: unknown) {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;

    return typeof code === "string" ? code : undefined;
  }

  return undefined;
}

/** Minúsculas y sin acentos: los mensajes del RPC vienen acentuados. */
function normalizeRpcMessage(message: string) {
  return message
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function throwIfRpcError(error: unknown): void {
  if (!error) {
    return;
  }

  const message = getSupabaseErrorMessage(error);
  const mapped = RPC_SQLSTATE_MAP[getSupabaseErrorSqlState(error) ?? ""];

  if (mapped) {
    throw new ApiError(mapped.status, mapped.code, message);
  }

  // Red de seguridad si el patch se aplicó sin los errcodes (versión vieja).
  const normalized = normalizeRpcMessage(message);

  if (normalized.includes("saldo insuficiente en el baul")) {
    throw new ApiError(400, "INSUFFICIENT_VAULT_BALANCE", message);
  }

  if (normalized.includes("no existe") || normalized.includes("not found")) {
    throw new ApiError(404, "NOT_FOUND", message);
  }

  if (normalized.includes("solo un administrador") || normalized.includes("no autorizado")) {
    throw new ApiError(403, "FORBIDDEN", message);
  }

  if (normalized.includes("ya esta") || normalized.includes("ya fue")) {
    throw new ApiError(409, "CONFLICT", message);
  }

  throw mapSupabaseError(error);
}

function assertRpcData<T>(data: T | null | undefined, message: string): T {
  if (data === null || data === undefined) {
    throw new ApiError(500, "INTERNAL_ERROR", message);
  }

  return data;
}

// -----------------------------------------------------------------------------
// Mappers (PostgREST devuelve `numeric` como string)
// -----------------------------------------------------------------------------

type Row = Record<string, unknown>;

function num(value: unknown, fallback = 0) {
  return value === null || value === undefined ? fallback : Number(value);
}

function nullableNum(value: unknown) {
  return value === null || value === undefined ? null : Number(value);
}

function mapSettings(row: Row): PayrollSettings {
  return {
    commissionSince: (row.commission_since as string | null) ?? getCaracasIsoDate(),
    defaultCommissionPct: num(row.default_commission_pct, 3),
    eligibleRoles: (row.eligible_roles as UserRole[] | null) ?? ["vendedor"],
    reinvestPct: num(row.reinvest_pct, 45),
    reservePct: num(row.reserve_pct, 20),
    storeId: row.store_id as string,
    updatedAt: row.updated_at as string,
    warnShareOfGrossProfitPct: num(row.warn_share_of_gross_profit_pct, 40),
  };
}

function defaultSettings(storeId: string): PayrollSettings {
  return {
    commissionSince: getCaracasIsoDate(),
    defaultCommissionPct: 3,
    eligibleRoles: ["vendedor"],
    reinvestPct: 45,
    reservePct: 20,
    storeId,
    updatedAt: new Date(0).toISOString(),
    warnShareOfGrossProfitPct: 40,
  };
}

function mapPeriod(row: Row): PayrollPeriod {
  return {
    approvedAt: (row.approved_at as string | null) ?? null,
    approvedBy: (row.approved_by as string | null) ?? null,
    commissionRef: num(row.commission_ref),
    createdAt: row.created_at as string,
    fromDate: row.from_date as string,
    grossProfitRef: nullableNum(row.gross_profit_ref),
    id: row.id as string,
    notes: (row.notes as string | null) ?? null,
    paidAt: (row.paid_at as string | null) ?? null,
    periodKey: row.period_key as string,
    reversalRef: num(row.reversal_ref),
    salesRef: num(row.sales_ref),
    shareOfGrossProfitPct: nullableNum(row.share_of_gross_profit_pct),
    status: row.status as PayrollPeriodStatus,
    storeId: row.store_id as string,
    toDate: row.to_date as string,
    totalRef: num(row.total_ref),
    updatedAt: row.updated_at as string,
  };
}

type ItemProfile = { full_name?: string | null; id: string };

function mapItem(row: Row): PayrollItem {
  const profile = row.profile as ItemProfile | ItemProfile[] | null | undefined;
  const resolved = Array.isArray(profile) ? profile[0] : profile;

  return {
    commissionPct: num(row.commission_pct),
    commissionRef: num(row.commission_ref),
    employeeId: row.employee_id as string,
    fullName: resolved?.full_name?.trim() ?? "Cajero",
    id: row.id as string,
    paidAmount: nullableNum(row.paid_amount),
    paidAt: (row.paid_at as string | null) ?? null,
    paidBy: (row.paid_by as string | null) ?? null,
    paidCurrency: (row.paid_currency as PayrollPaidCurrency | null) ?? null,
    paidMethod: (row.paid_method as PaymentMethod | null) ?? null,
    paidRateVes: nullableNum(row.paid_rate_ves),
    paidRef: nullableNum(row.paid_ref),
    paidReference: (row.paid_reference as string | null) ?? null,
    paidVes: nullableNum(row.paid_ves),
    periodId: row.period_id as string,
    profileId: row.profile_id as string,
    reversalRef: num(row.reversal_ref),
    salesCount: Number(row.sales_count ?? 0),
    salesRef: num(row.sales_ref),
    status: row.status as PayrollItem["status"],
    storeId: row.store_id as string,
    totalRef: num(row.total_ref),
    vaultMovementId: (row.vault_movement_id as string | null) ?? null,
  };
}

type CommissionSaleRow = Row & {
  sale?: { created_at: string; invoice_number: string | null } | null;
};

function mapCommissionSale(row: CommissionSaleRow): PayrollCommissionSale {
  const sale = Array.isArray(row.sale) ? row.sale[0] : row.sale;

  return {
    commissionRef: num(row.commission_ref),
    createdAt: row.created_at as string,
    id: row.id as string,
    invoiceNumber: sale?.invoice_number ?? null,
    kind: row.kind as PayrollCommissionKind,
    saleCreatedAt: sale?.created_at ?? (row.created_at as string),
    saleId: row.sale_id as string,
    saleTotalRef: num(row.sale_total_ref),
  };
}

const ITEM_SELECT = "*, profile:profiles!payroll_items_profile_id_fkey(id, full_name)";
const COMMISSION_SALE_SELECT = "*, sale:sales(created_at, invoice_number)";

// -----------------------------------------------------------------------------
// Ganancia bruta (solo informa: alimenta el semáforo)
// -----------------------------------------------------------------------------

/**
 * Si el reporte de margen falla, la quincena se calcula igual: la comisión no
 * depende de él y el semáforo queda "sin datos" (caso 10.5 del plan).
 */
async function resolveGrossProfitRef(storeId: string, fromDate: string, toDate: string) {
  try {
    const report = await getGrossProfitReport(
      new URLSearchParams({ from: fromDate, limit: "100", to: toDate }),
      [storeId],
    );

    return report.items.length === 0
      ? null
      : roundMoney(report.items.reduce((total, row) => total + row.grossProfitRef, 0));
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// Settings y empleados
// -----------------------------------------------------------------------------

async function readSettings(storeId: string) {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("payroll_settings")
    .select("*")
    .eq("store_id", storeId)
    .maybeSingle();

  throwIfSupabaseError(error);

  return data ? mapSettings(data as Row) : defaultSettings(storeId);
}

/** Perfiles activos con un rol elegible + su fila de `payroll_employees` si existe. */
async function readEligibleEmployees(settings: PayrollSettings): Promise<PayrollEmployee[]> {
  const supabase = await createRouteSupabaseClient();

  const [profilesResult, employeesResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, role, is_active")
      .eq("store_id", settings.storeId)
      .eq("is_active", true)
      .in("role", settings.eligibleRoles)
      .order("full_name", { ascending: true, nullsFirst: false }),
    supabase.from("payroll_employees").select("*").eq("store_id", settings.storeId),
  ]);

  throwIfSupabaseError(profilesResult.error);
  throwIfSupabaseError(employeesResult.error);

  const byProfile = new Map(
    (employeesResult.data ?? []).map((row) => [(row as Row).profile_id as string, row as Row]),
  );

  return (profilesResult.data ?? []).map((profile) => {
    const row = byProfile.get((profile as Row).id as string);

    return {
      commissionPct: row ? num(row.commission_pct) : settings.defaultCommissionPct,
      employeeId: (row?.id as string | undefined) ?? null,
      fullName: ((profile as Row).full_name as string | null)?.trim() ?? "Cajero",
      isActive: (row?.is_active as boolean | undefined) ?? false,
      profileId: (profile as Row).id as string,
      role: (profile as Row).role as UserRole,
    };
  });
}

export async function getPayrollSettings(storeId: string): Promise<PayrollSettingsView> {
  const settings = await readSettings(storeId);

  return { employees: await readEligibleEmployees(settings), settings };
}

export async function updatePayrollSettings(
  input: PayrollSettingsInput,
  _storeId: string,
): Promise<PayrollSettingsView> {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase.rpc("upsert_payroll_settings", {
    p_default_commission_pct: input.defaultCommissionPct ?? null,
    p_commission_since: input.commissionSince ?? null,
    p_eligible_roles: input.eligibleRoles ?? null,
    p_reinvest_pct: input.reinvestPct ?? null,
    p_reserve_pct: input.reservePct ?? null,
    p_warn_share_of_gross_profit_pct: input.warnShareOfGrossProfitPct ?? null,
  });

  throwIfRpcError(error);

  const settings = mapSettings(
    assertRpcData(data, "No se pudo guardar la configuración de nómina.") as Row,
  );

  return { employees: await readEligibleEmployees(settings), settings };
}

export async function upsertPayrollEmployee(
  profileId: string,
  input: PayrollEmployeeInput,
  storeId: string,
): Promise<PayrollEmployee> {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase.rpc("upsert_payroll_employee", {
    p_commission_pct: input.commissionPct,
    p_is_active: input.isActive ?? true,
    p_profile_id: profileId,
  });

  throwIfRpcError(error);

  const row = assertRpcData(data, "No se pudo guardar el porcentaje del cajero.") as Row;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .eq("id", profileId)
    .eq("store_id", storeId)
    .maybeSingle();

  throwIfSupabaseError(profileError);

  return {
    commissionPct: num(row.commission_pct),
    employeeId: row.id as string,
    fullName: ((profile as Row | null)?.full_name as string | null)?.trim() ?? "Cajero",
    isActive: Boolean(row.is_active),
    profileId,
    role: ((profile as Row | null)?.role as UserRole | undefined) ?? "vendedor",
  };
}

// -----------------------------------------------------------------------------
// Quincenas
// -----------------------------------------------------------------------------

export async function listPayrollPeriods(searchParams: URLSearchParams, storeId: string) {
  const supabase = await createRouteSupabaseClient();
  const { skip, to } = getPaginationRange(searchParams);
  const result = await supabase
    .from("payroll_periods")
    .select("*", { count: "exact" })
    .eq("store_id", storeId)
    .order("from_date", { ascending: false })
    .range(skip, to);

  return toPaginatedList(searchParams, result, (row) => mapPeriod(row as Row));
}

async function computePeriod(periodKey: string, storeId: string) {
  const range = parsePeriodKey(periodKey);

  if (!range) {
    throw new ApiError(400, "BAD_REQUEST", "Rango de quincena inválido.");
  }

  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase.rpc("compute_payroll_period", {
    p_from: range.fromDate,
    p_gross_profit_ref: await resolveGrossProfitRef(storeId, range.fromDate, range.toDate),
    p_period_key: periodKey,
    p_to: range.toDate,
  });

  throwIfRpcError(error);

  return mapPeriod(assertRpcData(data, "No se pudo calcular la quincena.") as Row);
}

export async function createPayrollPeriod(input: { periodKey: string }, storeId: string) {
  return computePeriod(input.periodKey, storeId);
}

async function readPeriod(id: string, storeId: string) {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("payroll_periods")
    .select("*")
    .eq("id", id)
    .eq("store_id", storeId)
    .maybeSingle();

  throwIfSupabaseError(error);

  if (!data) {
    throw new ApiError(404, "NOT_FOUND", "La quincena no existe.");
  }

  return mapPeriod(data as Row);
}

export async function recomputePayrollPeriod(id: string, storeId: string) {
  const period = await readPeriod(id, storeId);

  return computePeriod(period.periodKey, storeId);
}

export async function approvePayrollPeriod(id: string, _storeId: string) {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase.rpc("approve_payroll_period", { p_period_id: id });

  throwIfRpcError(error);

  return mapPeriod(assertRpcData(data, "No se pudo aprobar la quincena.") as Row);
}

export async function getPayrollPeriodDetail(
  id: string,
  storeId: string,
  access: { canManage: boolean; profileId?: string } = { canManage: true },
): Promise<PayrollPeriodDetail> {
  const supabase = await createRouteSupabaseClient();
  const period = await readPeriod(id, storeId);
  const settings = await readSettings(storeId);

  let itemsQuery = supabase.from("payroll_items").select(ITEM_SELECT).eq("period_id", id);

  if (!access.canManage) {
    itemsQuery = itemsQuery.eq("profile_id", access.profileId ?? "");
  }

  const { data: itemRows, error: itemsError } = await itemsQuery;

  throwIfSupabaseError(itemsError);

  const items = (itemRows ?? []).map((row) => mapItem(row as Row));

  if (!access.canManage && items.length === 0) {
    throw new ApiError(404, "NOT_FOUND", "La quincena no existe.");
  }

  const { data: saleRows, error: salesError } = await supabase
    .from("payroll_commission_sales")
    .select(COMMISSION_SALE_SELECT)
    .in(
      "item_id",
      items.map((item) => item.id),
    );

  throwIfSupabaseError(salesError);

  const salesByItem: Record<string, PayrollCommissionSale[]> = Object.fromEntries(
    items.map((item) => [item.id, [] as PayrollCommissionSale[]]),
  );

  for (const row of saleRows ?? []) {
    const itemId = (row as Row).item_id as string;
    salesByItem[itemId]?.push(mapCommissionSale(row as CommissionSaleRow));
  }

  return {
    breakdown: access.canManage
      ? ownerBreakdown(
          period.grossProfitRef,
          period.commissionRef,
          settings.reinvestPct,
          settings.reservePct,
        )
      : null,
    items,
    period: access.canManage ? period : redactPeriodForCashier(period),
    salesByItem,
    salesWithoutCashier: access.canManage ? await readSalesWithoutCashier(period) : 0,
    settings,
  };
}

/** El RPC lo recalcula al computar; aquí solo se lee el snapshot de la quincena. */
async function readSalesWithoutCashier(period: PayrollPeriod) {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase
    .from("payroll_periods")
    .select("sales_without_cashier")
    .eq("id", period.id)
    .maybeSingle();

  throwIfSupabaseError(error);

  return Number((data as Row | null)?.sales_without_cashier ?? 0);
}

// -----------------------------------------------------------------------------
// Pago desde el baúl
// -----------------------------------------------------------------------------

export async function payPayrollItem(
  id: string,
  input: PayrollPayInput,
  _storeId: string,
): Promise<PayrollItem> {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase.rpc("pay_payroll_item", {
    p_amount: input.amount,
    p_bank_name: input.bankName ?? null,
    p_item_id: id,
    p_method: input.method,
    p_reference: input.reference ?? null,
  });

  throwIfRpcError(error);

  return mapItem(assertRpcData(data, "No se pudo pagar el recibo de nómina.") as Row);
}

export async function cancelPayrollPayment(
  id: string,
  input: PayrollCancelPaymentInput,
  _storeId: string,
): Promise<PayrollItem> {
  const supabase = await createRouteSupabaseClient();
  const { data, error } = await supabase.rpc("cancel_payroll_payment", {
    p_item_id: id,
    p_notes: input.notes,
  });

  throwIfRpcError(error);

  return mapItem(assertRpcData(data, "No se pudo anular el pago de nómina.") as Row);
}

// -----------------------------------------------------------------------------
// Vistas del cajero y de la quincena en curso
// -----------------------------------------------------------------------------

type PreviewRow = {
  commission_pct: number | string;
  commission_ref: number | string;
  employee_id: string;
  full_name: string | null;
  kind: PayrollCommissionKind;
  profile_id: string;
  sale_total_ref: number | string;
};

function toEstimateRows(rows: readonly PreviewRow[]): PayrollEstimateRow[] {
  const byEmployee = new Map<string, PreviewRow[]>();

  for (const row of rows) {
    byEmployee.set(row.employee_id, [...(byEmployee.get(row.employee_id) ?? []), row]);
  }

  return [...byEmployee.values()].map((group) => {
    const totals = sumItem(
      group.map((row) => ({
        commissionRef: num(row.commission_ref),
        kind: row.kind,
        saleTotalRef: num(row.sale_total_ref),
      })),
    );

    return {
      commissionPct: num(group[0].commission_pct),
      commissionRef: totals.commissionRef,
      fullName: group[0].full_name?.trim() ?? "Cajero",
      profileId: group[0].profile_id,
      reversalRef: totals.reversalRef,
      salesCount: totals.salesCount,
      salesRef: totals.salesRef,
      totalRef: totals.totalRef,
    };
  });
}

export async function getPayrollCurrent(storeId: string): Promise<PayrollCurrentSummary> {
  const supabase = await createRouteSupabaseClient();
  const periodKey = currentPeriodKey();
  const range = parsePeriodKey(periodKey);
  const previousKey = previousPeriodKey(periodKey) ?? periodKey;

  const { data, error } = await supabase.rpc("preview_payroll_commissions", {
    p_from: range?.fromDate ?? null,
    p_to: range?.toDate ?? null,
  });

  throwIfRpcError(error);

  const estimate = toEstimateRows((data ?? []) as PreviewRow[]);

  const { data: previous, error: previousError } = await supabase
    .from("payroll_periods")
    .select("*")
    .eq("store_id", storeId)
    .eq("period_key", previousKey)
    .maybeSingle();

  throwIfSupabaseError(previousError);

  return {
    currentPeriodKey: periodKey,
    estimate,
    estimateTotalRef: roundMoney(estimate.reduce((total, row) => total + row.totalRef, 0)),
    previousPeriod: previous ? mapPeriod(previous as Row) : null,
    previousPeriodKey: previousKey,
  };
}

export async function listMyPayrollItems(
  searchParams: URLSearchParams,
  access: { profileId: string; storeId: string },
) {
  const supabase = await createRouteSupabaseClient();
  const { skip, to } = getPaginationRange(searchParams);
  const result = await supabase
    .from("payroll_items")
    .select(`${ITEM_SELECT}, period:payroll_periods(*)`, { count: "exact" })
    .eq("store_id", access.storeId)
    .eq("profile_id", access.profileId)
    .order("created_at", { ascending: false })
    .range(skip, to);

  const list = await toPaginatedList(searchParams, result, (row) => row as Row);
  const itemIds = list.items.map((row) => row.id as string);

  const { data: saleRows, error: salesError } = await supabase
    .from("payroll_commission_sales")
    .select(COMMISSION_SALE_SELECT)
    .in("item_id", itemIds);

  throwIfSupabaseError(salesError);

  const items: PayrollMineItem[] = list.items.map((row) => {
    const period = Array.isArray(row.period) ? row.period[0] : row.period;

    return {
      item: mapItem(row),
      // El cajero ve su recibo, no las cuentas del negocio.
      period: redactPeriodForCashier(mapPeriod(period as Row)),
      sales: (saleRows ?? [])
        .filter((sale) => (sale as Row).item_id === row.id)
        .map((sale) => mapCommissionSale(sale as CommissionSaleRow)),
    };
  });

  return { ...list, items };
}

/**
 * Estimación viva del propio cajero. `payroll_employees` solo lo lee el admin, así
 * que el porcentaje sale del snapshot de su recibo más reciente: un vendedor sin
 * recibos previos todavía no tiene con qué estimar.
 */
export async function getMyPayrollCurrent(access: {
  profileId: string;
  storeId: string;
}): Promise<PayrollMineCurrent> {
  const supabase = await createRouteSupabaseClient();
  const periodKey = currentPeriodKey();
  const range = parsePeriodKey(periodKey);

  const { data: lastItem, error: itemError } = await supabase
    .from("payroll_items")
    .select("commission_pct")
    .eq("store_id", access.storeId)
    .eq("profile_id", access.profileId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  throwIfSupabaseError(itemError);

  const commissionPct = lastItem ? num((lastItem as Row).commission_pct) : null;

  if (commissionPct === null || !range) {
    return { commissionPct, currentPeriodKey: periodKey, estimate: null };
  }

  const { data: sales, error: salesError } = await supabase
    .from("sales")
    .select("id, total_ref, created_at")
    .eq("store_id", access.storeId)
    .eq("user_id", access.profileId)
    .eq("status", "pagada")
    .gte("created_at", `${range.fromDate}T04:00:00.000Z`)
    // El día operativo Caracas termina a las 04:00Z del día siguiente: sin el
    // `+1` la estimación perdía el último día completo de la quincena.
    .lt("created_at", `${shiftIsoDate(range.toDate, 1)}T04:00:00.000Z`);

  throwIfSupabaseError(salesError);

  // Una venta que ya comisionó no vuelve a contar, igual que en el cálculo real.
  const { data: consumed, error: consumedError } = await supabase
    .from("payroll_commission_sales")
    .select("sale_id")
    .eq("store_id", access.storeId)
    .in("kind", ["normal", "late"]);

  throwIfSupabaseError(consumedError);

  const alreadyCommissioned = new Set(
    (consumed ?? []).map((row) => (row as Row).sale_id as string),
  );

  const totals = sumItem(
    (sales ?? [])
      .filter((sale) => !alreadyCommissioned.has((sale as Row).id as string))
      .map((sale) => ({
        commissionRef: roundMoney(num((sale as Row).total_ref) * (commissionPct / 100)),
        kind: "normal" as const,
        saleTotalRef: num((sale as Row).total_ref),
      })),
  );

  return {
    commissionPct,
    currentPeriodKey: periodKey,
    estimate: {
      commissionPct,
      commissionRef: totals.commissionRef,
      fullName: "",
      profileId: access.profileId,
      reversalRef: totals.reversalRef,
      salesCount: totals.salesCount,
      salesRef: totals.salesRef,
      totalRef: totals.totalRef,
    },
  };
}
