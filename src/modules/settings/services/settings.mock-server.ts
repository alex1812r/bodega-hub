import { ApiError } from "@/lib/api/apiError";
import { assertMockStoreResource } from "@/lib/api/assertStoreResource";
import { paginateList } from "@/lib/api/pagination";
import {
  mockAppSettings,
  mockUserProfiles,
  type AppSettingsMock,
  type UserProfileMock,
} from "@/shared/mocks/erp-data";
import { mockState } from "@/shared/mocks/mockStore";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import {
  DEFAULT_CASH_CLOSE_DIFF_ALERT_VES,
  parseCashCloseDiffAlertVes,
  type CashCloseSettings,
} from "./cashCloseSettings.schemas";
import type { CreateStoreUserInput } from "./createStoreUserSchema";
import {
  defaultPricingSettings,
  parsePricingSettings,
  type PricingSettings,
} from "./pricingSettings.schemas";
import { mockTaxRatesForStore } from "./taxRates.mock-server";
import { DEFAULT_TAX_RATE_UNAVAILABLE_MESSAGE } from "./taxRates.schemas";

/** Configuración de la tienda tal como la devuelve `/api/settings`. */
export type AppSettings = AppSettingsMock & CashCloseSettings;
export type SettingsInput = Partial<AppSettings>;
export type UserProfileInput = Partial<
  Pick<UserProfileMock, "deniedPermissions" | "grantedPermissions" | "isActive" | "name" | "role">
>;

/** `mockAppSettings` es la configuracion de la tienda demo. */
function ownsMockSettings(storeId: string) {
  return (mockAppSettings.storeId ?? DEFAULT_STORE_ID) === storeId;
}

/**
 * Ajustes de precios en memoria, por tienda (como las columnas de
 * `app_settings`). La tienda demo parte de `mockAppSettings.pricing`; cualquier
 * otra, de los valores por defecto de `@bodega/core`.
 */
function pricingByStore() {
  return mockState<Map<string, PricingSettings>>("settings:pricing", () => new Map());
}

export function getPricingSettings(storeId: string): PricingSettings {
  const stored = pricingByStore().get(storeId);
  const pricing =
    stored ?? (ownsMockSettings(storeId) ? mockAppSettings.pricing : defaultPricingSettings());

  return { ...pricing, chipsPct: [...pricing.chipsPct] };
}

/**
 * Umbral de faltante al cerrar caja en memoria, por tienda (como la columna
 * `app_settings.cash_close_diff_alert_ves`). Sin configurar vale 0.
 */
function cashCloseDiffAlertByStore() {
  return mockState<Map<string, number>>("settings:cash-close-diff-alert", () => new Map());
}

export function getCashCloseSettings(storeId: string): CashCloseSettings {
  return {
    cashCloseDiffAlertVes:
      cashCloseDiffAlertByStore().get(storeId) ?? DEFAULT_CASH_CLOSE_DIFF_ALERT_VES,
  };
}

/** Misma regla que el servicio real: la alicuota debe verla la tienda y estar activa. */
function findActiveStoreTaxRate(taxRateId: string, storeId: string) {
  const rate = mockTaxRatesForStore(storeId).find(
    (candidate) => candidate.id === taxRateId && candidate.isActive,
  );

  if (!rate) {
    throw new ApiError(400, "BAD_REQUEST", DEFAULT_TAX_RATE_UNAVAILABLE_MESSAGE);
  }

  return rate;
}

export function getSettings(storeId: string): AppSettings {
  return {
    ...mockAppSettings,
    ...getCashCloseSettings(storeId),
    pricing: getPricingSettings(storeId),
    storeId: mockAppSettings.storeId ?? storeId,
  };
}

/**
 * Persisten en memoria los ajustes de precios y el umbral de faltante al cerrar
 * caja (por tienda) y la alicuota por
 * defecto (en la tienda demo, de donde la lee el mock de alicuotas). El resto de
 * campos se devuelven con el cambio aplicado, como hasta ahora.
 */
export function updateSettings(input: SettingsInput, storeId: string) {
  // Todo se valida antes de escribir nada: un rechazo no deja cambios a medias.
  const pricing = input.pricing !== undefined ? parsePricingSettings(input.pricing) : undefined;
  const cashCloseDiffAlertVes =
    input.cashCloseDiffAlertVes !== undefined
      ? parseCashCloseDiffAlertVes(input.cashCloseDiffAlertVes)
      : undefined;
  const taxRate =
    input.defaultTaxRateId != null
      ? findActiveStoreTaxRate(input.defaultTaxRateId, storeId)
      : undefined;
  // Como el trigger de la base: con alicuota, el porcentaje es el suyo.
  const defaultTaxRate = taxRate
    ? { defaultTaxRate: taxRate.pct, defaultTaxRateId: taxRate.id }
    : {};

  if (pricing) {
    pricingByStore().set(storeId, pricing);
  }

  if (cashCloseDiffAlertVes !== undefined) {
    cashCloseDiffAlertByStore().set(storeId, cashCloseDiffAlertVes);
  }

  if (taxRate && ownsMockSettings(storeId)) {
    Object.assign(mockAppSettings, defaultTaxRate);
  }

  return {
    ...getSettings(storeId),
    ...input,
    ...defaultTaxRate,
    ...getCashCloseSettings(storeId),
    pricing: getPricingSettings(storeId),
    storeId,
  };
}

export function listUsers(searchParams: URLSearchParams, storeId: string) {
  const items = mockUserProfiles.filter((profile) => profile.storeId === storeId);

  return paginateList(items, searchParams);
}

export function updateUser(id: string, input: UserProfileInput, storeId: string) {
  const user = mockUserProfiles.find((profile) => profile.id === id);
  assertMockStoreResource(
    user ? { storeId: user.storeId ?? undefined } : null,
    storeId,
    "Usuario no encontrado.",
  );

  if (!user || user.storeId == null) {
    throw new ApiError(404, "NOT_FOUND", "Usuario no encontrado.");
  }

  Object.assign(user, input);

  return {
    ...user,
  };
}

export function createUser(input: CreateStoreUserInput, storeId: string) {
  const email = input.email.trim().toLowerCase();

  if (mockUserProfiles.some((profile) => profile.email.toLowerCase() === email)) {
    throw new ApiError(409, "CONFLICT", "Ya existe un usuario con este correo.");
  }

  const user: UserProfileMock = {
    email,
    id: `user-mock-${Date.now()}`,
    isActive: true,
    name: input.fullName.trim(),
    role: input.role,
    storeId,
  };

  mockUserProfiles.push(user);
  return user;
}
