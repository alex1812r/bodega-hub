"use client";

import { Save } from "lucide-react";
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
import { roleLabels, userRoles, type UserRole } from "@/shared/auth/permissions";
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
import { SelectField } from "@/shared/components/SelectField";
import type { ExchangeRateMock, UserProfileMock } from "@/shared/mocks/erp-data";

import {
  useCreateExchangeRate,
  useCurrentExchangeRate,
  useExchangeRates,
} from "../hooks/useCurrentExchangeRate";
import { ResponsivePagination, usePaginationState } from "@/shared/components/Pagination";

import {
  useSettings,
  useUpdateSettings,
  useUpdateUser,
  useUsers,
} from "../hooks/useSettings";

type SettingsFormState = {
  businessName: string;
  defaultTaxRate: string;
  invoicePrefix: string;
  lowStockThreshold: string;
};

type ExchangeRateFormState = {
  rateVes: string;
  source: string;
};

const initialSettingsForm: SettingsFormState = {
  businessName: "",
  defaultTaxRate: "0",
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
  defaultTaxRate: number;
  invoicePrefix: string;
  lowStockThreshold: number;
}): SettingsFormState {
  return {
    businessName: data.businessName,
    defaultTaxRate: String(data.defaultTaxRate),
    invoicePrefix: data.invoicePrefix,
    lowStockThreshold: String(data.lowStockThreshold),
  };
}

function SettingsUserRow({ user }: { user: UserProfileMock }) {
  const updateUser = useUpdateUser(user.id);

  return (
    <tr className="border-t border-slate-200 dark:border-slate-800">
      <td className="px-3 py-2 text-sm">{user.name}</td>
      <td className="px-3 py-2 text-sm">{user.email}</td>
      <td className="px-3 py-2 text-sm">
        <SelectField
          label="Rol"
          onChange={(event) =>
            void updateUser.mutateAsync({ role: event.target.value as UserRole })
          }
          options={roleOptions}
          value={user.role}
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

const roleOptions = userRoles.map((role) => ({
  label: roleLabels[role],
  value: role,
}));

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
          options={roleOptions}
          value={demoRole}
        />
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Rol actual: <strong>{roleLabels[demoRole]}</strong>
        </p>
      </CardContent>
    </Card>
  );
}

export function SettingsListPage() {
  const settingsQuery = useSettings();
  const usersPagination = usePaginationState([]);
  const usersQuery = useUsers({
    limit: usersPagination.limit,
    skip: usersPagination.skip,
  });
  const currentRateQuery = useCurrentExchangeRate();
  const exchangeRatesPagination = usePaginationState([]);
  const exchangeRatesQuery = useExchangeRates({
    limit: exchangeRatesPagination.limit,
    skip: exchangeRatesPagination.skip,
  });
  const updateSettings = useUpdateSettings();
  const createExchangeRate = useCreateExchangeRate();
  const [settingsForm, setSettingsForm] =
    useState<SettingsFormState>(initialSettingsForm);
  const [exchangeRateForm, setExchangeRateForm] = useState<ExchangeRateFormState>(
    initialExchangeRateForm,
  );
  const showDemoAuthCard = isDemoAuthEnabledUi();
  const loadedSettingsKey = settingsQuery.data
    ? `${settingsQuery.data.businessName}-${settingsQuery.data.invoicePrefix}`
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

    return (
      settingsForm.businessName !== loaded.businessName ||
      settingsForm.defaultTaxRate !== loaded.defaultTaxRate ||
      settingsForm.invoicePrefix !== loaded.invoicePrefix ||
      settingsForm.lowStockThreshold !== loaded.lowStockThreshold
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

    updateSettings.mutate({
      businessName: settingsForm.businessName,
      defaultTaxRate: Number(settingsForm.defaultTaxRate),
      invoicePrefix: settingsForm.invoicePrefix,
      lowStockThreshold: Number(settingsForm.lowStockThreshold),
    });
  }

  function handleExchangeRateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    createExchangeRate.mutate({
      rateVes: Number(exchangeRateForm.rateVes),
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

  const headerActions = (
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
  );

  return (
    <EntityListPage
      actions={headerActions}
      description={`Administra los parametros generales de BodegaHub${getPageDataSourceSuffix()}`}
      layout="sections"
      title="Configuracion del sistema"
    >
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
              <Input
                disabled={settingsQuery.isLoading}
                label="IVA por defecto (%)"
                min="0"
                onChange={(event) =>
                  setSettingsForm((current) => ({
                    ...current,
                    defaultTaxRate: event.target.value,
                  }))
                }
                step="0.01"
                type="number"
                value={settingsForm.defaultTaxRate}
              />
              <Input
                disabled={settingsQuery.isLoading}
                label="Umbral bajo inventario"
                min="0"
                onChange={(event) =>
                  setSettingsForm((current) => ({
                    ...current,
                    lowStockThreshold: event.target.value,
                  }))
                }
                type="number"
                value={settingsForm.lowStockThreshold}
              />
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

      <Card>
        <CardHeader>
          <CardTitle>Usuarios</CardTitle>
          <CardDescription>
            {isMockDataSource()
              ? "Perfiles mock disponibles para permisos y operaciones demo."
              : "Usuarios del negocio con acceso al ERP."}
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

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Tasa vigente (DolarAPI oficial)</CardTitle>
            <CardDescription>{currentRateDescription}</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleExchangeRateSubmit}>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                La tasa operativa se obtiene en el servidor desde DolarAPI. El registro manual
                solo alimenta el historial; no reemplaza la tasa vigente.
              </p>
              <Input
                label="Tasa manual (historial)"
                min="0"
                onChange={(event) =>
                  setExchangeRateForm((current) => ({
                    ...current,
                    rateVes: event.target.value,
                  }))
                }
                required
                step="0.01"
                type="number"
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
                {createExchangeRate.isPending ? "Registrando..." : "Registrar en historial"}
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
    </EntityListPage>
  );
}
