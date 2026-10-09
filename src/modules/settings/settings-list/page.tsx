"use client";

import { Plus, Save } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { type FormEvent, useMemo, useState } from "react";

import {
  getExchangeRateSavedMessage,
  getPageDataSourceSuffix,
  isDemoAuthEnabledUi,
  isMockDataSource,
} from "@/lib/api/dataSourceUi";
import { getPaginatedItems } from "@/lib/api/pagination";
import { getStoredDemoRole, setStoredDemoRole } from "@/shared/auth/demoAuth";
import { usePermission } from "@/shared/auth/usePermission";
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
import { NumberInput } from "@/shared/components/NumberInput";
import { ResponsivePagination } from "@/shared/components/Pagination";
import { SelectField } from "@/shared/components/SelectField";
import { Tabs } from "@/shared/components/Tabs";
import { withUrlListBoundary } from "@/shared/hooks/useUrlListState";
import type { ExchangeRateMock } from "@/shared/mocks/erp-data";

import {
  useCreateExchangeRate,
  useCurrentExchangeRate,
  useExchangeRates,
} from "../hooks/useCurrentExchangeRate";
import { useUsers } from "../hooks/useSettings";
import { CreateStoreUserModal } from "./components/CreateStoreUserModal";
import { GeneralSettingsCard, SETTINGS_FORM_ID } from "./components/GeneralSettingsCard";
import { PricingSettingsSection } from "./components/PricingSettingsSection";
import { SettingsUsersTable } from "./components/SettingsUsersTable";
import { TaxSettingsSection } from "./components/TaxSettingsSection";
import {
  DEFAULT_SETTINGS_TAB,
  resolveSettingsTab,
  SETTINGS_TAB_PARAM,
  type SettingsTab,
} from "./settingsListParams";
import { useGeneralSettingsForm } from "./useGeneralSettingsForm";
import { usePendingUserChanges } from "./usePendingUserChanges";
import {
  useLastValidPage,
  useSettingsRatesPagination,
  useSettingsUsersPagination,
} from "./useSettingsPagination";

type ExchangeRateFormState = {
  rateVes: string;
  source: string;
};

const initialExchangeRateForm: ExchangeRateFormState = {
  rateVes: "",
  source: "Manual",
};

const demoRoleOptions = userRoles.map((role) => ({
  label: roleLabels[role],
  value: role,
}));

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
  const generalSettings = useGeneralSettingsForm();
  // Rol y estado elegidos en las filas y aún sin guardar: sobreviven a paginar y a cambiar de pestaña.
  const pendingUserChanges = usePendingUserChanges();
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
  const createExchangeRate = useCreateExchangeRate();
  const [exchangeRateForm, setExchangeRateForm] = useState<ExchangeRateFormState>(
    initialExchangeRateForm,
  );
  const showDemoAuthCard = isDemoAuthEnabledUi();

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

  function handleExchangeRateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    createExchangeRate.mutate({
      // Dos decimales, como deja el campo al salir (Enter envía sin pasar por ahí).
      rateVes: Math.round(Number(exchangeRateForm.rateVes) * 100) / 100,
      source: exchangeRateForm.source || "Manual",
    });
    setExchangeRateForm(initialExchangeRateForm);
  }

  const headerActions =
    activeTab === "general" ? (
      <>
        <Button
          disabled={!generalSettings.isDirty || generalSettings.isLoading}
          onClick={generalSettings.discard}
          type="button"
          variant="secondary"
        >
          Descartar cambios
        </Button>
        <Button
          disabled={
            !generalSettings.isDirty || generalSettings.isSaving || generalSettings.isLoading
          }
          form={SETTINGS_FORM_ID}
          type="submit"
          variant="primary"
        >
          <Save aria-hidden className="h-4 w-4" />
          {generalSettings.isSaving ? "Guardando..." : "Guardar"}
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
                  <GeneralSettingsCard settings={generalSettings} />

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
                      <SettingsUsersTable
                        changes={pendingUserChanges}
                        users={getPaginatedItems(usersQuery.data)}
                      />
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
