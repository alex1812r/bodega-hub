import {
  getCaracasIsoDate,
  roundMoney,
  shiftIsoDate,
  type PaymentMethod,
  type UserRole,
} from "@bodega/core";

import { ApiError } from "@/lib/api/apiError";
import { paginateList } from "@/lib/api/pagination";
import { getGrossProfitReport } from "@/modules/reports/services/reports.mock-server";
import { getCurrentExchangeRate } from "@/modules/settings/services/exchangeRates.mock-server";
import {
  __resetVaultMockState,
  registerPayrollOut,
  revertPayrollOut,
  seedVaultBalance,
  getVault,
} from "@/modules/vault/services/vault.mock-server";
import { mockSales, mockUserProfiles, type SaleMock } from "@/shared/mocks/erp-data";
import { mockState } from "@/shared/mocks/mockStore";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

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
  PayrollPayInput,
  PayrollPeriod,
  PayrollPeriodDetail,
  PayrollSettings,
  PayrollSettingsInput,
  PayrollSettingsView,
} from "../types";
import {
  commissionForSale,
  ownerBreakdown,
  reversalEntry,
  shareOfGrossProfit,
  sumItem,
  sumPeriod,
  type PayrollCommissionEntry,
  type PayrollCommissionKind,
} from "../utils/payrollMath";
import { redactPeriodForCashier } from "../utils/periodVisibility";
import {
  currentPeriodKey,
  isPeriodClosed,
  parsePeriodKey,
  previousPeriodKey,
} from "../utils/quincena";

/**
 * Mock de nómina con la misma semántica que `supabase/patches/20260907-payroll.sql`:
 * una venta comisiona una sola vez en toda la historia, las cobradas tarde entran
 * en la quincena que se calcule después, los reversos restan, el `commission_pct`
 * queda congelado en el ítem y una quincena pagada es inmutable.
 *
 * El estado vive a nivel de módulo (patrón de `vault.mock-server`) y el baúl es
 * **el mismo** que el del módulo de baúl: los pagos salen de ahí y aparecen en
 * `/api/vault/movements` como `payroll_out`.
 */

// -----------------------------------------------------------------------------
// Estado
// -----------------------------------------------------------------------------

type PayrollEmployeeRow = {
  commissionPct: number;
  createdAt: string;
  id: string;
  isActive: boolean;
  profileId: string;
  storeId: string;
  updatedAt: string;
};

type PayrollCommissionSaleRow = PayrollCommissionSale & {
  itemId: string;
  storeId: string;
};

/** Fila candidata del cálculo, equivalente a `preview_payroll_commissions`. */
type PayrollPreviewRow = {
  commissionPct: number;
  commissionRef: number;
  employeeId: string;
  fullName: string;
  invoiceNumber: string | null;
  kind: PayrollCommissionKind;
  profileId: string;
  saleCreatedAt: string;
  saleId: string;
  saleTotalRef: number;
};

// Anclado a globalThis: `next dev` reevalua este modulo al navegar y sin esto la
// nomina se vaciaria entre pantallas. Ver `src/shared/mocks/mockStore.ts`.
const settingsByStore = mockState("payroll:settings", () => new Map<string, PayrollSettings>());
const employees = mockState<PayrollEmployeeRow[]>("payroll:employees", () => []);
const periods = mockState<PayrollPeriod[]>("payroll:periods", () => []);
const items = mockState<PayrollItem[]>("payroll:items", () => []);
const commissionSales = mockState<PayrollCommissionSaleRow[]>(
  "payroll:commission-sales",
  () => [],
);
const seededVaults = mockState("payroll:seeded-vaults", () => new Set<string>());
const sequence = mockState("payroll:sequence", () => ({ value: 0 }));

function nextId(prefix: string) {
  sequence.value += 1;

  return `${prefix}-mock-${String(sequence.value)}`;
}

function now() {
  return new Date().toISOString();
}

/**
 * El baúl mock nace en cero, así que sin esto ningún pago de nómina sería
 * demostrable. Se siembra una sola vez por tienda, sin asiento en el libro:
 * es un saldo de apertura, no un movimiento del negocio.
 */
function ensureVaultSeed(storeId: string) {
  if (seededVaults.has(storeId)) {
    return;
  }

  seededVaults.add(storeId);
  seedVaultBalance(
    { balanceEfectivoVes: 250_000, balanceRef: 800, balanceVes: 150_000 },
    storeId,
  );
}

function getSettings(storeId: string): PayrollSettings {
  ensureVaultSeed(storeId);

  let settings = settingsByStore.get(storeId);

  if (!settings) {
    settings = {
      // En Supabase la frontera nace el día en que se configura la nómina, que
      // es lo prudente para una tienda con historia. El mock la retrasa 90 días
      // para que la demo tenga quincenas anteriores y una venta cobrada tarde.
      commissionSince: shiftIsoDate(getCaracasIsoDate(), -90),
      defaultCommissionPct: 3,
      eligibleRoles: ["vendedor"],
      reinvestPct: 45,
      reservePct: 20,
      storeId,
      updatedAt: now(),
      warnShareOfGrossProfitPct: 40,
    };
    settingsByStore.set(storeId, settings);
  }

  return settings;
}

// -----------------------------------------------------------------------------
// Empleados elegibles
// -----------------------------------------------------------------------------

function storeProfiles(storeId: string) {
  return mockUserProfiles.filter((profile) => profile.storeId === storeId);
}

function findProfile(profileId: string) {
  return mockUserProfiles.find((profile) => profile.id === profileId);
}

function profileName(profileId: string) {
  return findProfile(profileId)?.name ?? "Cajero";
}

function findEmployeeRow(storeId: string, profileId: string) {
  return employees.find((row) => row.storeId === storeId && row.profileId === profileId);
}

/** Perfiles activos de la tienda con un rol elegible, con su fila de nómina si la tienen. */
function listEligibleEmployees(storeId: string): PayrollEmployee[] {
  const settings = getSettings(storeId);

  return storeProfiles(storeId)
    .filter((profile) => profile.isActive && settings.eligibleRoles.includes(profile.role))
    .map((profile) => {
      const row = findEmployeeRow(storeId, profile.id);

      return {
        commissionPct: row?.commissionPct ?? settings.defaultCommissionPct,
        employeeId: row?.id ?? null,
        fullName: profile.name,
        isActive: row?.isActive ?? false,
        profileId: profile.id,
        role: profile.role,
      };
    });
}

/** Empleados que sí comisionan: fila activa de nómina y perfil activo. */
function activePayrollEmployees(storeId: string) {
  return employees.filter((row) => {
    const profile = findProfile(row.profileId);

    return row.storeId === storeId && row.isActive && profile?.isActive === true;
  });
}

// -----------------------------------------------------------------------------
// Cálculo (espejo de `preview_payroll_commissions`)
// -----------------------------------------------------------------------------

function periodBounds(fromDate: string, toDate: string) {
  return {
    endUtcExclusive: `${shiftIsoDate(toDate, 1)}T04:00:00.000Z`,
    startUtc: `${fromDate}T04:00:00.000Z`,
  };
}

function storeSales(storeId: string) {
  return mockSales.filter((sale) => (sale.storeId ?? DEFAULT_STORE_ID) === storeId);
}

function isCommissioned(saleId: string) {
  return commissionSales.some(
    (row) => row.saleId === saleId && (row.kind === "normal" || row.kind === "late"),
  );
}

function isReversed(saleId: string) {
  return commissionSales.some((row) => row.saleId === saleId && row.kind === "reversal");
}

function previewCommissions(
  storeId: string,
  fromDate: string,
  toDate: string,
): PayrollPreviewRow[] {
  const { endUtcExclusive, startUtc } = periodBounds(fromDate, toDate);
  const eligible = activePayrollEmployees(storeId);
  const rows: PayrollPreviewRow[] = [];

  // Frontera con el pasado: sin ella la primera quincena arrastraría como
  // "cobrada tarde" toda la historia de ventas pagadas de la tienda.
  const since = `${getSettings(storeId).commissionSince}T04:00:00.000Z`;

  // Ventas cobradas que aún no comisionaron. `late` = venta anterior al rango
  // que se cobró después: entra en la quincena que se calcule tras cobrarla.
  for (const sale of storeSales(storeId)) {
    const employee = eligible.find((row) => row.profileId === sale.userId);

    if (
      !employee ||
      sale.status !== "pagada" ||
      sale.createdAt < since ||
      sale.createdAt >= endUtcExclusive ||
      isCommissioned(sale.id)
    ) {
      continue;
    }

    rows.push({
      commissionPct: employee.commissionPct,
      commissionRef: commissionForSale(sale.totalRef, employee.commissionPct),
      employeeId: employee.id,
      fullName: profileName(employee.profileId),
      invoiceNumber: sale.invoiceNumber,
      kind: sale.createdAt >= startUtc ? "normal" : "late",
      profileId: employee.profileId,
      saleCreatedAt: sale.createdAt,
      saleId: sale.id,
      saleTotalRef: sale.totalRef,
    });
  }

  // Ventas ya comisionadas que quedaron canceladas o devueltas: se descuenta lo
  // que se pagó por ellas, una sola vez.
  for (const consumed of commissionSales) {
    if (consumed.storeId !== storeId || consumed.kind === "reversal") {
      continue;
    }

    const sale = mockSales.find((candidate) => candidate.id === consumed.saleId);
    const item = items.find((candidate) => candidate.id === consumed.itemId);
    // Los reversos no miran si el cajero sigue activo: lo que ya se comisionó
    // hay que descontarlo aunque lo hayan desactivado entretanto.
    const employee = item
      ? employees.find(
          (row) => row.storeId === storeId && row.profileId === item.profileId,
        )
      : undefined;

    if (
      !sale ||
      !employee ||
      (sale.status !== "cancelada" && sale.status !== "devuelta") ||
      isReversed(sale.id)
    ) {
      continue;
    }

    const entry = reversalEntry(sale.totalRef, consumed.commissionRef);

    rows.push({
      commissionPct: employee.commissionPct,
      commissionRef: entry.commissionRef,
      employeeId: employee.id,
      fullName: profileName(employee.profileId),
      invoiceNumber: sale.invoiceNumber,
      kind: "reversal",
      profileId: employee.profileId,
      saleCreatedAt: sale.createdAt,
      saleId: sale.id,
      saleTotalRef: sale.totalRef,
    });
  }

  return rows;
}

/** Ventas cobradas de la quincena que no comisionan a nadie (admin o sin cajero). */
function salesWithoutCashier(storeId: string, fromDate: string, toDate: string) {
  const { endUtcExclusive, startUtc } = periodBounds(fromDate, toDate);
  const eligible = activePayrollEmployees(storeId);

  return storeSales(storeId).filter(
    (sale: SaleMock) =>
      sale.status === "pagada" &&
      sale.createdAt >= startUtc &&
      sale.createdAt < endUtcExclusive &&
      !eligible.some((row) => row.profileId === sale.userId),
  ).length;
}

function toEntries(rows: readonly PayrollPreviewRow[]): PayrollCommissionEntry[] {
  return rows.map((row) => ({
    commissionRef: row.commissionRef,
    kind: row.kind,
    saleTotalRef: row.saleTotalRef,
  }));
}

/**
 * La ganancia bruta solo alimenta el semáforo: si el reporte falla, la quincena
 * se calcula igual y el semáforo queda "sin datos" (caso 10.5 del plan).
 */
function resolveGrossProfitRef(storeId: string, fromDate: string, toDate: string) {
  try {
    const report = getGrossProfitReport(
      new URLSearchParams({ from: fromDate, limit: "100", to: toDate }),
      [storeId],
    );
    const rows = report.items.filter(
      (row) => row.saleDate >= fromDate && row.saleDate <= toDate,
    );

    return rows.length === 0
      ? null
      : roundMoney(rows.reduce((total, row) => total + row.grossProfitRef, 0));
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// Settings y empleados
// -----------------------------------------------------------------------------

export function getPayrollSettings(storeId: string): PayrollSettingsView {
  return { employees: listEligibleEmployees(storeId), settings: { ...getSettings(storeId) } };
}

export function updatePayrollSettings(
  input: PayrollSettingsInput,
  storeId: string,
): PayrollSettingsView {
  const settings = getSettings(storeId);

  if (input.eligibleRoles) {
    if (input.eligibleRoles.length === 0) {
      throw new ApiError(400, "BAD_REQUEST", "Debe haber al menos un rol elegible para la nómina.");
    }

    if (input.eligibleRoles.some((role: UserRole) => role === "admin" || role === "superadmin")) {
      throw new ApiError(
        400,
        "BAD_REQUEST",
        "El administrador no cobra nómina: sus retiros salen del baúl.",
      );
    }

    settings.eligibleRoles = [...input.eligibleRoles];
  }

  settings.commissionSince = input.commissionSince ?? settings.commissionSince;
  settings.defaultCommissionPct = input.defaultCommissionPct ?? settings.defaultCommissionPct;
  settings.warnShareOfGrossProfitPct =
    input.warnShareOfGrossProfitPct ?? settings.warnShareOfGrossProfitPct;
  settings.reinvestPct = input.reinvestPct ?? settings.reinvestPct;
  settings.reservePct = input.reservePct ?? settings.reservePct;
  settings.updatedAt = now();

  return getPayrollSettings(storeId);
}

export function upsertPayrollEmployee(
  profileId: string,
  input: PayrollEmployeeInput,
  storeId: string,
): PayrollEmployee {
  const settings = getSettings(storeId);

  if (input.commissionPct < 0 || input.commissionPct > 100) {
    throw new ApiError(400, "BAD_REQUEST", "El porcentaje de comisión debe estar entre 0 y 100.");
  }

  const profile = storeProfiles(storeId).find((candidate) => candidate.id === profileId);

  if (!profile) {
    throw new ApiError(404, "NOT_FOUND", "El empleado no pertenece a esta tienda.");
  }

  if (profile.role === "admin" || profile.role === "superadmin") {
    throw new ApiError(
      400,
      "BAD_REQUEST",
      "El administrador no cobra nómina: sus retiros salen del baúl.",
    );
  }

  const existing = findEmployeeRow(storeId, profileId);
  const commissionPct = roundMoney(input.commissionPct);
  const isActive = input.isActive ?? true;

  if (existing) {
    existing.commissionPct = commissionPct;
    existing.isActive = isActive;
    existing.updatedAt = now();
  } else {
    employees.push({
      commissionPct,
      createdAt: now(),
      id: nextId("payroll-employee"),
      isActive,
      profileId,
      storeId,
      updatedAt: now(),
    });
  }

  const row = findEmployeeRow(storeId, profileId);

  return {
    commissionPct: row?.commissionPct ?? settings.defaultCommissionPct,
    employeeId: row?.id ?? null,
    fullName: profile.name,
    isActive: row?.isActive ?? false,
    profileId,
    role: profile.role,
  };
}

// -----------------------------------------------------------------------------
// Quincenas
// -----------------------------------------------------------------------------

function findPeriod(id: string, storeId: string) {
  const period = periods.find((row) => row.id === id && row.storeId === storeId);

  if (!period) {
    throw new ApiError(404, "NOT_FOUND", "La quincena no existe.");
  }

  return period;
}

function periodItems(periodId: string) {
  return items.filter((item) => item.periodId === periodId);
}

function applyPeriodTotals(period: PayrollPeriod) {
  const totals = sumPeriod(periodItems(period.id));

  period.salesRef = totals.salesRef;
  period.commissionRef = totals.commissionRef;
  period.reversalRef = totals.reversalRef;
  period.totalRef = totals.totalRef;
  period.shareOfGrossProfitPct = shareOfGrossProfit(totals.commissionRef, period.grossProfitRef);
  period.updatedAt = now();
}

/** Crea o recalcula el borrador. Espejo de `compute_payroll_period`. */
function computePeriod(periodKey: string, storeId: string) {
  const range = parsePeriodKey(periodKey);

  if (!range) {
    throw new ApiError(400, "BAD_REQUEST", "Rango de quincena inválido.");
  }

  if (!isPeriodClosed(periodKey)) {
    throw new ApiError(
      400,
      "BAD_REQUEST",
      "La quincena no ha terminado: solo se puede estimar hasta que cierre.",
    );
  }

  let period = periods.find((row) => row.storeId === storeId && row.periodKey === periodKey);

  if (period && period.status !== "borrador") {
    throw new ApiError(
      409,
      "CONFLICT",
      `La quincena ya está ${period.status} y no se puede recalcular.`,
    );
  }

  const grossProfitRef = resolveGrossProfitRef(storeId, range.fromDate, range.toDate);

  if (!period) {
    period = {
      approvedAt: null,
      approvedBy: null,
      commissionRef: 0,
      createdAt: now(),
      fromDate: range.fromDate,
      grossProfitRef,
      id: nextId("payroll-period"),
      notes: null,
      paidAt: null,
      periodKey,
      reversalRef: 0,
      salesRef: 0,
      shareOfGrossProfitPct: null,
      status: "borrador",
      storeId,
      toDate: range.toDate,
      totalRef: 0,
      updatedAt: now(),
    };
    periods.push(period);
  } else {
    period.grossProfitRef = grossProfitRef;
  }

  // Los ítems de un borrador son desechables: se recalculan desde cero.
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index].periodId === period.id) {
      items.splice(index, 1);
    }
  }

  const rows = previewCommissions(storeId, range.fromDate, range.toDate);

  // Los cajeros activos sin ventas también reciben su ítem, en cero.
  for (const employee of activePayrollEmployees(storeId)) {
    const own = rows.filter((row) => row.employeeId === employee.id);
    const totals = sumItem(toEntries(own));

    items.push({
      commissionPct: employee.commissionPct,
      commissionRef: totals.commissionRef,
      employeeId: employee.id,
      fullName: profileName(employee.profileId),
      id: nextId("payroll-item"),
      paidAmount: null,
      paidAt: null,
      paidBy: null,
      paidCurrency: null,
      paidMethod: null,
      paidRateVes: null,
      paidRef: null,
      paidReference: null,
      paidVes: null,
      periodId: period.id,
      profileId: employee.profileId,
      reversalRef: totals.reversalRef,
      salesCount: totals.salesCount,
      salesRef: totals.salesRef,
      status: "pendiente",
      storeId,
      totalRef: totals.totalRef,
      vaultMovementId: null,
    });
  }

  applyPeriodTotals(period);

  return period;
}

export function listPayrollPeriods(searchParams: URLSearchParams, storeId: string) {
  const rows = periods
    .filter((period) => period.storeId === storeId)
    .sort((first, second) => second.fromDate.localeCompare(first.fromDate));

  return paginateList(rows, searchParams);
}

export function createPayrollPeriod(input: { periodKey: string }, storeId: string) {
  return computePeriod(input.periodKey, storeId);
}

export function recomputePayrollPeriod(id: string, storeId: string) {
  const period = findPeriod(id, storeId);

  return computePeriod(period.periodKey, storeId);
}

export function approvePayrollPeriod(id: string, storeId: string) {
  const period = findPeriod(id, storeId);

  if (period.status !== "borrador") {
    throw new ApiError(409, "CONFLICT", `La quincena ya está ${period.status}.`);
  }

  // Recalcular una última vez: entre calcular y aprobar pudieron cancelarse ventas.
  computePeriod(period.periodKey, storeId);

  const rows = periodItems(period.id);

  if (rows.length === 0) {
    throw new ApiError(
      400,
      "BAD_REQUEST",
      "No hay empleados con comisión configurada para esta quincena.",
    );
  }

  const candidates = previewCommissions(storeId, period.fromDate, period.toDate);

  // El índice único de Postgres falla si otra quincena ya consumió una venta.
  for (const candidate of candidates) {
    const alreadyTaken =
      candidate.kind === "reversal" ? isReversed(candidate.saleId) : isCommissioned(candidate.saleId);

    if (alreadyTaken) {
      throw new ApiError(
        409,
        "CONFLICT",
        "Otra quincena ya comisionó alguna de estas ventas. Recalcula antes de aprobar.",
      );
    }
  }

  for (const candidate of candidates) {
    const item = rows.find((row) => row.employeeId === candidate.employeeId);

    if (!item) {
      continue;
    }

    commissionSales.push({
      commissionRef: candidate.commissionRef,
      createdAt: now(),
      id: nextId("payroll-commission-sale"),
      invoiceNumber: candidate.invoiceNumber,
      itemId: item.id,
      kind: candidate.kind,
      saleCreatedAt: candidate.saleCreatedAt,
      saleId: candidate.saleId,
      saleTotalRef: candidate.saleTotalRef,
      storeId,
    });
  }

  period.status = "aprobado";
  period.approvedAt = now();
  period.approvedBy = null;
  period.updatedAt = now();

  return period;
}

// -----------------------------------------------------------------------------
// Detalle
// -----------------------------------------------------------------------------

/** La fila interna lleva `itemId`/`storeId`; el contrato de la API no. */
function toCommissionSale(row: PayrollCommissionSaleRow): PayrollCommissionSale {
  return {
    commissionRef: row.commissionRef,
    createdAt: row.createdAt,
    id: row.id,
    invoiceNumber: row.invoiceNumber,
    kind: row.kind,
    saleCreatedAt: row.saleCreatedAt,
    saleId: row.saleId,
    saleTotalRef: row.saleTotalRef,
  };
}

function salesByItem(periodId: string) {
  const grouped: Record<string, PayrollCommissionSale[]> = {};

  for (const item of periodItems(periodId)) {
    grouped[item.id] = commissionSales
      .filter((row) => row.itemId === item.id)
      .map(toCommissionSale);
  }

  return grouped;
}

export function getPayrollPeriodDetail(
  id: string,
  storeId: string,
  access: { canManage: boolean; profileId?: string } = { canManage: true },
): PayrollPeriodDetail {
  const period = findPeriod(id, storeId);
  const settings = getSettings(storeId);
  const all = periodItems(period.id);
  const visible = access.canManage
    ? all
    : all.filter((item) => item.profileId === access.profileId);

  if (!access.canManage && visible.length === 0) {
    throw new ApiError(404, "NOT_FOUND", "La quincena no existe.");
  }

  const grouped = salesByItem(period.id);

  return {
    breakdown: access.canManage
      ? ownerBreakdown(
          period.grossProfitRef,
          period.commissionRef,
          settings.reinvestPct,
          settings.reservePct,
        )
      : null,
    items: visible.map((item) => ({ ...item })),
    period: access.canManage ? { ...period } : redactPeriodForCashier(period),
    salesByItem: Object.fromEntries(
      visible.map((item) => [item.id, grouped[item.id] ?? []]),
    ),
    salesWithoutCashier: access.canManage
      ? salesWithoutCashier(storeId, period.fromDate, period.toDate)
      : 0,
    settings: { ...settings },
  };
}

// -----------------------------------------------------------------------------
// Pago desde el baúl
// -----------------------------------------------------------------------------

function findItem(id: string, storeId: string) {
  const item = items.find((row) => row.id === id && row.storeId === storeId);

  if (!item) {
    throw new ApiError(404, "NOT_FOUND", "El recibo de nómina no existe.");
  }

  return item;
}

/** Cubeta y moneda del baúl según el método, igual que `pay_payroll_item`. */
function resolveTender(method: PaymentMethod) {
  if (method === "efectivo_usd") {
    return { bucket: "efectivo", currency: "USD" } as const;
  }

  if (method === "efectivo_ves") {
    return { bucket: "efectivo", currency: "VES" } as const;
  }

  if (method === "pago_movil" || method === "transferencia") {
    return { bucket: "cuenta", currency: "VES" } as const;
  }

  throw new ApiError(400, "BAD_REQUEST", "La nómina no se puede pagar por punto de venta.");
}

function assertVaultBalance(
  storeId: string,
  bucket: "cuenta" | "efectivo",
  currency: "USD" | "VES",
  amountVes: number,
  amountRef: number,
) {
  const vault = getVault(storeId);
  const details = {
    balanceEfectivoVes: vault.balanceEfectivoVes,
    balanceRef: vault.balanceRef,
    balanceVes: vault.balanceVes,
  };

  if (bucket === "efectivo" && currency === "VES" && amountVes > vault.balanceEfectivoVes) {
    throw new ApiError(
      400,
      "INSUFFICIENT_VAULT_BALANCE",
      `Saldo insuficiente en el baul (efectivo). Faltante VES: ${String(roundMoney(amountVes - vault.balanceEfectivoVes))}`,
      details,
    );
  }

  if (bucket === "efectivo" && currency === "USD" && amountRef > vault.balanceRef) {
    throw new ApiError(
      400,
      "INSUFFICIENT_VAULT_BALANCE",
      `Saldo insuficiente en el baul. Faltante REF: ${String(roundMoney(amountRef - vault.balanceRef))}`,
      details,
    );
  }

  if (bucket === "cuenta" && amountVes > vault.balanceVes) {
    throw new ApiError(
      400,
      "INSUFFICIENT_VAULT_BALANCE",
      `Saldo insuficiente en el baul (cuenta). Faltante VES: ${String(roundMoney(amountVes - vault.balanceVes))}`,
      details,
    );
  }
}

export function payPayrollItem(id: string, input: PayrollPayInput, storeId: string): PayrollItem {
  ensureVaultSeed(storeId);

  const item = findItem(id, storeId);

  if (item.status === "pagado") {
    throw new ApiError(409, "CONFLICT", "Este recibo ya fue pagado.");
  }

  const period = findPeriod(item.periodId, storeId);

  if (period.status === "borrador") {
    throw new ApiError(400, "BAD_REQUEST", "Aprueba la quincena antes de pagar.");
  }

  if (item.totalRef <= 0) {
    // Un cajero sin ventas no mueve dinero: se marca pagado y ya.
    item.status = "pagado";
    item.paidAt = now();
    item.paidAmount = 0;
    item.paidVes = 0;
    item.paidRef = 0;
  } else {
    if (input.amount <= 0) {
      throw new ApiError(400, "BAD_REQUEST", "El monto a pagar debe ser mayor a cero.");
    }

    const { bucket, currency } = resolveTender(input.method);

    if (
      (input.method === "pago_movil" || input.method === "transferencia") &&
      !input.reference?.trim()
    ) {
      throw new ApiError(400, "BAD_REQUEST", "Indica la referencia del pago.");
    }

    const rateVes = getCurrentExchangeRate(storeId).rateVes;

    if (rateVes <= 0) {
      throw new ApiError(400, "BAD_REQUEST", "No hay una tasa de cambio vigente para pagar la nómina.");
    }

    const amountVes = currency === "USD" ? 0 : roundMoney(input.amount);
    const amountRef = currency === "USD" ? roundMoney(input.amount) : 0;

    // El recibo se paga completo: no hay abonos parciales. Se tolera un 1 % por
    // si la tasa que vio la pantalla no es exactamente la de este momento.
    const deliveredRef =
      currency === "USD" ? roundMoney(input.amount) : roundMoney(input.amount / rateVes);

    if (Math.abs(deliveredRef - item.totalRef) > Math.max(0.02, item.totalRef * 0.01)) {
      throw new ApiError(
        400,
        "BAD_REQUEST",
        `El monto no corresponde al recibo: son ref ${item.totalRef.toFixed(2)}, y se intentó pagar ref ${deliveredRef.toFixed(2)}.`,
      );
    }

    assertVaultBalance(storeId, bucket, currency, amountVes, amountRef);

    const movement = registerPayrollOut(
      {
        amountRef,
        amountVes,
        bucket,
        notes: [
          `Nómina ${period.periodKey}`,
          input.bankName?.trim(),
          input.reference?.trim(),
        ]
          .filter(Boolean)
          .join(" · "),
        payrollItemId: item.id,
      },
      storeId,
    );

    item.status = "pagado";
    item.paidMethod = input.method;
    item.paidCurrency = currency;
    item.paidAmount = roundMoney(input.amount);
    item.paidVes = amountVes;
    item.paidRef = currency === "USD" ? amountRef : roundMoney(amountVes / rateVes);
    item.paidRateVes = rateVes;
    item.paidReference = input.reference?.trim() ?? null;
    item.paidAt = now();
    item.vaultMovementId = movement.id;
  }

  if (periodItems(period.id).every((row) => row.status === "pagado")) {
    period.status = "pagado";
    period.paidAt = now();
    period.updatedAt = now();
  }

  return { ...item };
}

export function cancelPayrollPayment(
  id: string,
  input: PayrollCancelPaymentInput,
  storeId: string,
): PayrollItem {
  const item = findItem(id, storeId);

  if (item.status !== "pagado") {
    throw new ApiError(409, "CONFLICT", "Este recibo no está pagado.");
  }

  if (!input.notes.trim()) {
    throw new ApiError(400, "BAD_REQUEST", "Explica por qué se anula el pago.");
  }

  if (item.vaultMovementId) {
    revertPayrollOut(item.vaultMovementId, storeId, input.notes.trim());
  }

  item.status = "pendiente";
  item.paidMethod = null;
  item.paidCurrency = null;
  item.paidAmount = null;
  item.paidVes = null;
  item.paidRef = null;
  item.paidRateVes = null;
  item.paidReference = null;
  item.paidAt = null;
  item.paidBy = null;
  item.vaultMovementId = null;

  const period = findPeriod(item.periodId, storeId);

  // Las ventas comisionadas no se tocan: siguen consumidas.
  if (period.status === "pagado") {
    period.status = "aprobado";
    period.paidAt = null;
    period.notes = [period.notes, `Pago anulado: ${input.notes.trim()}`]
      .filter(Boolean)
      .join("\n");
    period.updatedAt = now();
  }

  return { ...item };
}

// -----------------------------------------------------------------------------
// Vistas del cajero y de la quincena en curso
// -----------------------------------------------------------------------------

function toEstimateRows(rows: readonly PayrollPreviewRow[]): PayrollEstimateRow[] {
  const byEmployee = new Map<string, PayrollPreviewRow[]>();

  for (const row of rows) {
    byEmployee.set(row.employeeId, [...(byEmployee.get(row.employeeId) ?? []), row]);
  }

  return [...byEmployee.values()].map((group) => {
    const totals = sumItem(toEntries(group));

    return {
      commissionPct: group[0].commissionPct,
      commissionRef: totals.commissionRef,
      fullName: group[0].fullName,
      profileId: group[0].profileId,
      reversalRef: totals.reversalRef,
      salesCount: totals.salesCount,
      salesRef: totals.salesRef,
      totalRef: totals.totalRef,
    };
  });
}

export function getPayrollCurrent(storeId: string): PayrollCurrentSummary {
  const periodKey = currentPeriodKey();
  const range = parsePeriodKey(periodKey);
  const previousKey = previousPeriodKey(periodKey) ?? periodKey;
  const estimate = range
    ? toEstimateRows(previewCommissions(storeId, range.fromDate, range.toDate))
    : [];

  return {
    currentPeriodKey: periodKey,
    estimate,
    estimateTotalRef: roundMoney(estimate.reduce((total, row) => total + row.totalRef, 0)),
    previousPeriod:
      periods.find((row) => row.storeId === storeId && row.periodKey === previousKey) ?? null,
    previousPeriodKey: previousKey,
  };
}

export function listMyPayrollItems(
  searchParams: URLSearchParams,
  access: { profileId: string; storeId: string },
) {
  const rows: PayrollMineItem[] = items
    .filter((item) => item.storeId === access.storeId && item.profileId === access.profileId)
    .map((item) => ({
      item: { ...item },
      // El cajero ve su recibo, no las cuentas del negocio.
      period: redactPeriodForCashier(findPeriod(item.periodId, access.storeId)),
      sales: commissionSales
        .filter((sale) => sale.itemId === item.id)
        .map(toCommissionSale),
    }))
    .sort((first, second) => second.period.fromDate.localeCompare(first.period.fromDate));

  return paginateList(rows, searchParams);
}

export function getMyPayrollCurrent(access: {
  profileId: string;
  storeId: string;
}): PayrollMineCurrent {
  const periodKey = currentPeriodKey();
  const range = parsePeriodKey(periodKey);
  const estimate = range
    ? toEstimateRows(previewCommissions(access.storeId, range.fromDate, range.toDate)).find(
        (row) => row.profileId === access.profileId,
      ) ?? null
    : null;

  return {
    commissionPct:
      estimate?.commissionPct ??
      findEmployeeRow(access.storeId, access.profileId)?.commissionPct ??
      null,
    currentPeriodKey: periodKey,
    estimate,
  };
}

/** Solo para tests: devuelve el módulo a su estado inicial. */
export function __resetPayrollMockState() {
  // El baúl también: la nómina lo siembra y le escribe movimientos, así que un
  // test no debe heredar los del anterior.
  __resetVaultMockState();
  settingsByStore.clear();
  employees.length = 0;
  periods.length = 0;
  items.length = 0;
  commissionSales.length = 0;
  seededVaults.clear();
  sequence.value = 0;
}
