"use client";

import { Plus, Save } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { type FormEvent, useMemo, useState } from "react";

import {
  getExchangeRateSavedMessage,
  getPageDataSourceSuffix,
  getSettingsSavedMessage,
  isDemoAuthEnabledUi,
  isMockDataSource,
} from "@/lib/api/dataSourceUi";
import { getPaginatedItems } from "@/lib/api/pagination";
import { getStoredDemoRole, setStoredDemoRole } from "@/shared/auth/demoAuth";
import { usePermission } from "@/shared/auth/usePermission";
import {
  roleLabels,
  storeUserRoles,
  userRoles,
  type StoreUserRole,
  type UserRole,
} from "@/shared/auth/permissions";
import { Button } from "@/shared/components/Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/Card";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { EntityListPage } from "@/shared/components/EntityListPage";
import { Input } from "@/shared/components/Input";
import { isIntegerText, NumberInput } from "@/shared/components/NumberInput";
import { ResponsivePagination } from "@/shared/components/Pagination";
import { SelectField } from "@/shared/components/SelectField";
import { Tabs } from "@/shared/components/Tabs";
import { withUrlListBoundary } from "@/shared/hooks/useUrlListState";
import type { ExchangeRateMock, PaymentMethod, UserProfileMock } from "@/shared/mocks/erp-data";
import {
  DEFAULT_ENABLED_PAYMENT_METHODS,
  normalizeEnabledPaymentMethods,
  PAYMENT_METHODS,
  paymentMethodLabels,
} from "@/shared/payments/paymentMethods";

import {
  useCreateExchangeRate,
  useCurrentExchangeRate,
  useExchangeRates,
} from "../hooks/useCurrentExchangeRate";
import { useSettings, useUpdateSettings, useUpdateUser, useUsers } from "../hooks/useSettings";
import { CreateStoreUserModal } from "./components/CreateStoreUserModal";
import { PricingSettingsSection } from "./components/PricingSettingsSection";
import { TaxSettingsSection } from "./components/TaxSettingsSection";
import {
  DEFAULT_SETTINGS_TAB,
  resolveSettingsTab,
  SETTINGS_TAB_PARAM,
  type SettingsTab,
} from "./settingsListParams";
import {
  useLastValidPage,
  useSettingsRatesPagination,
  useSettingsUsersPagination,
} from "./useSettingsPagination";

type SettingsFormState = {
  businessName: string;
  enabledPaymentMethods: PaymentMethod[];
  invoicePrefix: string;
  lowStockThreshold: string;
};

type ExchangeRateFormState = {
  rateVes: string;
  source: string;
};

const initialSettingsForm: SettingsFormState = {
  businessName: "",
  enabledPaymentMethods: [...DEFAULT_ENABLED_PAYMENT_METHODS],
  invoicePrefix: "",
  lowStockThreshold: "0",
};

const initialExchangeRateForm: ExchangeRateFormState = {
  rateVes: "",
  source: "Manual",
};

const SETTINGS_FORM_ID = "settings-general-form";

function toSettingsFormState(data: {
  businessName: string;
  enabledPaymentMethods?: PaymentMethod[];
  invoicePrefix: string;
  lowStockThreshold: number;
}): SettingsFormState {
  return {
    businessName: data.businessName,
    enabledPaymentMethods: normalizeEnabledPaymentMethods(data.enabledPaymentMethods),
    invoicePrefix: data.invoicePrefix,
    lowStockThreshold: String(data.lowStockThreshold),
  };
}

const storeRoleOptions = storeUserRoles.map((role) => ({
  label: roleLabels[role],
  value: role,
}));

const demoRoleOptions = userRoles.map((role) => ({
  label: roleLabels[role],
  value: role,
}));

function SettingsUserRow({ user }: { user: UserProfileMock }) {
  const updateUser = useUpdateUser(user.id);
  const roleValue = storeUserRoles.includes(user.role as StoreUserRole)
    ? user.role
    : "vendedor";

  return (
    <tr className="border-t border-slate-200 dark:border-slate-800">
      <td className="px-3 py-2 text-sm">{user.name}</td>
      <td className="px-3 py-2 text-sm">{user.email}</td>
      <td className="px-3 py-2 text-sm">
        <SelectField
          label="Rol"
          onChange={(event) =>
            void updateUser.mutateAsync({ role: event.target.value as StoreUserRole })
          }
          options={storeRoleOptions}
          value={roleValue}
        />
      </td>
      <td className="px-3 py-2 text-sm">
        <SelectField
          label="Estado"
          onChange={(event) =>
            void updateUser.mutateAsync({ isActive: event.target.value === "true" })
          }
          options={[
            { label: "Activo", value: "true" },
            { label: "Inactivo", value: "false" },
          ]}
          value={String(user.isActive)}
        />
      </td>
    </tr>
  );
}

const exchangeRateColumns: DataTableColumn<ExchangeRateMock>[] = [
  {
    header: "Fecha",
    key: "createdAt",
    render: (rate) => new Date(rate.createdAt).toLocaleString("es-VE"),
  },
  {
    align: "right",
    header: "REF/VES",
    key: "rateVes",
    render: (rate) => rate.rateVes.toLocaleString("es-VE"),
  },
  { header: "Fuente", key: "source", render: (rate) => rate.source },
];

function DemoAuthCard() {
  const [demoRole, setDemoRole] = useState<UserRole>(
    () => getStoredDemoRole() ?? "admin",
  );

  function handleDemoRoleChange(role: UserRole) {
    setDemoRole(role);
    setStoredDemoRole(role);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Auth demo</CardTitle>
        <CardDescription>
          Este rol se guarda localmente y viaja como header demo al API.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <SelectField
          label="Rol activo"
          onChange={(event) => handleDemoRoleChange(event.target.value as UserRole)}
          options={demoRoleOptions}
          value={demoRole}
        />
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Rol actual: <strong>{roleLabels[demoRole]}</strong>
        </p>
      </CardContent>
    </Card>
  );
}

function SettingsList() {
  const { can } = usePermission();
  // Mismo permiso que exige el servidor para guardar ajustes y cambiar alícuotas.
  const canEditSettings = can("users.manage");
  // La pestaña activa vive en `?tab=` (la escribe `Tabs`); aquí solo decide las acciones de la cabecera.
  const activeTab = resolveSettingsTab(useSearchParams().get(SETTINGS_TAB_PARAM));
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const settingsQuery = useSettings();
  // Dos listas en la pantalla: cada una lleva su página y su tamaño en la URL.
  const usersPagination = useSettingsUsersPagination();
  const usersQuery = useUsers({
    limit: usersPagination.limit,
    skip: usersPagination.skip,
  });
  const currentRateQuery = useCurrentExchangeRate();
  const exchangeRatesPagination = useSettingsRatesPagination();
  const exchangeRatesQuery = useExchangeRates({
    limit: exchangeRatesPagination.limit,
    skip: exchangeRatesPagination.skip,
  });
  useLastValidPage(usersPagination, usersQuery);
  useLastValidPage(exchangeRatesPagination, exchangeRatesQuery);
  const updateSettings = useUpdateSettings();
  const createExchangeRate = useCreateExchangeRate();
  const [settingsForm, setSettingsForm] =
    useState<SettingsFormState>(initialSettingsForm);
  const [exchangeRateForm, setExchangeRateForm] = useState<ExchangeRateFormState>(
    initialExchangeRateForm,
  );
  const showDemoAuthCard = isDemoAuthEnabledUi();
  const loadedSettingsKey = settingsQuery.data
    ? `${settingsQuery.data.businessName}-${settingsQuery.data.invoicePrefix}-${settingsQuery.data.enabledPaymentMethods.join(",")}`
    : "";
  const [syncedSettingsKey, setSyncedSettingsKey] = useState("");

  if (loadedSettingsKey && loadedSettingsKey !== syncedSettingsKey) {
    setSyncedSettingsKey(loadedSettingsKey);
    setSettingsForm(toSettingsFormState(settingsQuery.data!));
  }

  const isSettingsDirty = useMemo(() => {
    if (!settingsQuery.data) {
      return false;
    }

    const loaded = toSettingsFormState(settingsQuery.data);
    const enabledChanged =
      settingsForm.enabledPaymentMethods.length !== loaded.enabledPaymentMethods.length ||
      settingsForm.enabledPaymentMethods.some(
        (method) => !loaded.enabledPaymentMethods.includes(method),
      );

    return (
      settingsForm.businessName !== loaded.businessName ||
      settingsForm.invoicePrefix !== loaded.invoicePrefix ||
      settingsForm.lowStockThreshold !== loaded.lowStockThreshold ||
      enabledChanged
    );
  }, [settingsForm, settingsQuery.data]);

  const currentRateDescription = useMemo(() => {
    if (currentRateQuery.isError) {
      return "No se pudo obtener la tasa oficial desde el servidor (DolarAPI). Reintenta en unos minutos.";
    }

    if (currentRateQuery.isLoading) {
      return "Consultando tasa oficial USD/VES en el servidor...";
    }

    if (!currentRateQuery.data) {
      return "Sin tasa vigente.";
    }

    return `${currentRateQuery.data.rateVes.toLocaleString("es-VE")} VES por REF — fuente ${currentRateQuery.data.source} (vigente para ventas y compras).`;
  }, [currentRateQuery.data, currentRateQuery.isError, currentRateQuery.isLoading]);

  function handleSettingsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (settingsForm.enabledPaymentMethods.length === 0) {
      return;
    }

    // El umbral es un entero: con decimales el campo ya muestra su aviso y no se envía.
    if (settingsForm.lowStockThreshold !== "" && !isIntegerText(settingsForm.lowStockThreshold)) {
      return;
    }

    updateSettings.mutate({
      businessName: settingsForm.businessName,
      enabledPaymentMethods: settingsForm.enabledPaymentMethods,
      invoicePrefix: settingsForm.invoicePrefix,
      lowStockThreshold: Number(settingsForm.lowStockThreshold),
    });
  }

  function togglePaymentMethod(method: PaymentMethod) {
    setSettingsForm((current) => {
      const isEnabled = current.enabledPaymentMethods.includes(method);
      if (isEnabled) {
        if (current.enabledPaymentMethods.length <= 1) {
          return current;
        }
        return {
          ...current,
          enabledPaymentMethods: current.enabledPaymentMethods.filter(
            (item) => item !== method,
          ),
        };
      }

      return {
        ...current,
        enabledPaymentMethods: [...current.enabledPaymentMethods, method],
      };
    });
  }

  function handleExchangeRateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    createExchangeRate.mutate({
      // Dos decimales, como deja el campo al salir (Enter envía sin pasar por ahí).
      rateVes: Math.round(Number(exchangeRateForm.rateVes) * 100) / 100,
      source: exchangeRateForm.source || "Manual",
    });
    setExchangeRateForm(initialExchangeRateForm);
  }

  function handleDiscardSettings() {
    if (!settingsQuery.data) {
      return;
    }

    setSettingsForm(toSettingsFormState(settingsQuery.data));
  }

  const headerActions =
    activeTab === "general" ? (
      <>
        <Button
          disabled={!isSettingsDirty || settingsQuery.isLoading}
          onClick={handleDiscardSettings}
          type="button"
          variant="secondary"
        >
          Descartar cambios
        </Button>
        <Button
          disabled={
            !isSettingsDirty || updateSettings.isPending || settingsQuery.isLoading
          }
          form={SETTINGS_FORM_ID}
          type="submit"
          variant="primary"
        >
          <Save aria-hidden className="h-4 w-4" />
          {updateSettings.isPending ? "Guardando..." : "Guardar"}
        </Button>
      </>
    ) : activeTab === "usuarios" ? (
      <Button onClick={() => setCreateUserOpen(true)} type="button" variant="primary">
        <Plus aria-hidden className="h-4 w-4" />
        Nuevo usuario
      </Button>
    ) : null;

  return (
    <EntityListPage
      actions={headerActions}
      description={`Administra los parametros generales de BodegaHub${getPageDataSourceSuffix()}`}
      layout="sections"
      title="Configuracion del sistema"
    >
      <div className="overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm">
        <Tabs<SettingsTab>
          ariaLabel="Secciones de configuración"
          defaultValue={DEFAULT_SETTINGS_TAB}
          items={[
            {
              content: (
                <div
                  className={
                    showDemoAuthCard
                      ? "grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]"
                      : "grid grid-cols-1 gap-4"
                  }
                >
                  <Card>
                    <CardHeader>
                      <CardTitle>Datos generales</CardTitle>
                      <CardDescription>
                        Valores usados por facturacion, inventario y reportes.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <form
                        className="grid gap-4 md:grid-cols-2"
                        id={SETTINGS_FORM_ID}
                        onSubmit={handleSettingsSubmit}
                      >
                        <Input
                          disabled={settingsQuery.isLoading}
                          label="Nombre del negocio"
                          onChange={(event) =>
                            setSettingsForm((current) => ({
                              ...current,
                              businessName: event.target.value,
                            }))
                          }
                          value={settingsForm.businessName}
                        />
                        <Input
                          disabled={settingsQuery.isLoading}
                          label="Prefijo de factura"
                          onChange={(event) =>
                            setSettingsForm((current) => ({
                              ...current,
                              invoicePrefix: event.target.value,
                            }))
                          }
                          value={settingsForm.invoicePrefix}
                        />
                        <NumberInput
                          decimals={0}
                          disabled={settingsQuery.isLoading}
                          label="Umbral bajo inventario"
                          onChange={(event) =>
                            setSettingsForm((current) => ({
                              ...current,
                              lowStockThreshold: event.target.value,
                            }))
                          }
                          value={settingsForm.lowStockThreshold}
                        />

                        <fieldset className="space-y-3 md:col-span-2">
                          <legend className="text-sm font-medium text-foreground">
                            Metodos de pago habilitados
                          </legend>
                          <p className="text-sm text-muted-foreground">
                            Solo estos metodos estaran disponibles al vender. Debes dejar al menos uno
                            activo.
                          </p>
                          <div className="grid gap-2 sm:grid-cols-2">
                            {PAYMENT_METHODS.map((method) => {
                              const checked = settingsForm.enabledPaymentMethods.includes(method);
                              const isLastEnabled =
                                checked && settingsForm.enabledPaymentMethods.length === 1;

                              return (
                                <label
                                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface-container-lowest px-3 py-2 text-sm text-foreground dark:border-slate-700"
                                  key={method}
                                >
                                  <input
                                    checked={checked}
                                    className="size-4 accent-[var(--secondary)]"
                                    disabled={settingsQuery.isLoading || isLastEnabled}
                                    onChange={() => togglePaymentMethod(method)}
                                    type="checkbox"
                                  />
                                  {paymentMethodLabels[method]}
                                </label>
                              );
                            })}
                          </div>
                        </fieldset>

                        {(updateSettings.isSuccess ||
                          settingsQuery.error ||
                          updateSettings.error) && (
                          <div className="flex flex-wrap items-center gap-3 md:col-span-2">
                            {updateSettings.isSuccess ? (
                              <span className="text-sm text-emerald-600 dark:text-emerald-400">
                                {getSettingsSavedMessage()}
                              </span>
                            ) : null}
                            {settingsQuery.error || updateSettings.error ? (
                              <span className="text-sm text-red-600 dark:text-red-400">
                                No se pudieron guardar los ajustes.
                              </span>
                            ) : null}
                          </div>
                        )}
                      </form>
                    </CardContent>
                  </Card>

                  {showDemoAuthCard ? <DemoAuthCard /> : null}
                </div>
              ),
              label: "General / sistema",
              value: "general",
            },
            {
              content: (
                <TaxSettingsSection canEdit={canEditSettings} />
              ),
              label: "Impuestos",
              value: "impuestos",
            },
            {
              content: (
                <PricingSettingsSection canEdit={canEditSettings} />
              ),
              label: "Precios",
              value: "precios",
            },
            {
              content: (
                <Card>
                  <CardHeader>
                    <CardTitle>Usuarios del negocio</CardTitle>
                    <CardDescription>
                      {isMockDataSource()
                        ? "Perfiles mock disponibles para permisos y operaciones demo."
                        : "Crea y administra usuarios con acceso al ERP de esta tienda."}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {usersQuery.isLoading ? (
                      <p className="text-sm text-slate-500">Cargando usuarios...</p>
                    ) : usersQuery.error ? (
                      <p className="text-sm text-red-600">No pudimos cargar usuarios.</p>
                    ) : (
                      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                        <table className="min-w-full">
                          <thead className="bg-slate-50 text-left text-sm dark:bg-slate-900">
                            <tr>
                              <th className="px-3 py-2">Usuario</th>
                              <th className="px-3 py-2">Correo</th>
                              <th className="px-3 py-2">Rol</th>
                              <th className="px-3 py-2">Estado</th>
                            </tr>
                          </thead>
                          <tbody>
                            {getPaginatedItems(usersQuery.data).map((user) => (
                              <SettingsUserRow key={user.id} user={user} />
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    <ResponsivePagination
                      isDisabled={usersQuery.isFetching}
                      limit={usersPagination.limit}
                      onLimitChange={usersPagination.setLimit}
                      onSkipChange={usersPagination.setSkip}
                      skip={usersQuery.data?.skip ?? usersPagination.skip}
                      total={usersQuery.data?.total ?? 0}
                    />
                  </CardContent>
                </Card>
              ),
              label: "Usuarios",
              value: "usuarios",
            },
            {
              content: (
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
                  <Card>
                    <CardHeader>
                      <CardTitle>Tasa vigente (DolarAPI oficial)</CardTitle>
                      <CardDescription>{currentRateDescription}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <form className="space-y-4" onSubmit={handleExchangeRateSubmit}>
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                          La tasa operativa se obtiene en el servidor desde DolarAPI. El registro
                          manual solo alimenta el historial; no reemplaza la tasa vigente.
                        </p>
                        <NumberInput
                          decimals={2}
                          label="Tasa manual (historial)"
                          onChange={(event) =>
                            setExchangeRateForm((current) => ({
                              ...current,
                              rateVes: event.target.value,
                            }))
                          }
                          required
                          value={exchangeRateForm.rateVes}
                        />
                        <Input
                          label="Fuente"
                          onChange={(event) =>
                            setExchangeRateForm((current) => ({
                              ...current,
                              source: event.target.value,
                            }))
                          }
                          value={exchangeRateForm.source}
                        />
                        <Button disabled={createExchangeRate.isPending} type="submit">
                          {createExchangeRate.isPending
                            ? "Registrando..."
                            : "Registrar en historial"}
                        </Button>
                        {createExchangeRate.isSuccess ? (
                          <p className="text-sm text-emerald-600 dark:text-emerald-400">
                            {getExchangeRateSavedMessage()}
                          </p>
                        ) : null}
                        {currentRateQuery.error || createExchangeRate.error ? (
                          <p className="text-sm text-red-600 dark:text-red-400">
                            No se pudo cargar o registrar la tasa.
                          </p>
                        ) : null}
                      </form>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>Historial de tasas</CardTitle>
                      <CardDescription>
                        Registros devueltos por <code>/api/exchange-rates</code>.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <DataTable
                        columns={exchangeRateColumns}
                        data={getPaginatedItems(exchangeRatesQuery.data)}
                        error={exchangeRatesQuery.error}
                        getRowId={(rate) => rate.id}
                        isFetching={exchangeRatesQuery.isFetching}
                        isLoading={exchangeRatesQuery.isLoading}
                      />
                      <ResponsivePagination
                        isDisabled={exchangeRatesQuery.isFetching}
                        limit={exchangeRatesPagination.limit}
                        onLimitChange={exchangeRatesPagination.setLimit}
                        onSkipChange={exchangeRatesPagination.setSkip}
                        skip={exchangeRatesQuery.data?.skip ?? exchangeRatesPagination.skip}
                        total={exchangeRatesQuery.data?.total ?? 0}
                      />
                    </CardContent>
                  </Card>
                </div>
              ),
              label: "Tasas",
              value: "tasas",
            },
          ]}
          panelClassName="space-y-4 p-4 md:p-6"
          urlParam={SETTINGS_TAB_PARAM}
        />
      </div>

      <CreateStoreUserModal onOpenChange={setCreateUserOpen} open={createUserOpen} />
    </EntityListPage>
  );
}

/** La pestaña y las páginas se leen de la URL: la pantalla lleva su límite de Suspense. */
export const SettingsListPage = withUrlListBoundary(SettingsList);
