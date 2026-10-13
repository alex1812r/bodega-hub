"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { getPaginatedItems } from "@/lib/api/pagination";
import { Button } from "@/shared/components/Button";
import { EmptyState } from "@/shared/components/EmptyState";
import { Input } from "@/shared/components/Input";
import { LoadingState } from "@/shared/components/LoadingState";
import { PageHeader } from "@/shared/components/PageHeader";
import {
  getTotalPages,
  ResponsivePagination,
  useUrlPaginationState,
} from "@/shared/components/Pagination";
import { SelectField } from "@/shared/components/SelectField";
import { useDebouncedValue } from "@/shared/hooks/useDebouncedValue";
import { useScrollRestoration } from "@/shared/hooks/useScrollRestoration";
import {
  URL_LIST_DEBOUNCE_MS,
  useUrlListState,
  withUrlListBoundary,
} from "@/shared/hooks/useUrlListState";
import { withReturnTo } from "@/shared/utils/returnTo";

import { usePatchStore, useStoresList } from "../hooks/useStores";
import type { PlatformStore } from "../types/stores";
import { StoreCard } from "./components/StoreCard";
import { storesListSchema, toStoresFilters, type StoresListState } from "./storesListParams";

const statusOptions: { label: string; value: StoresListState["status"] }[] = [
  { label: "Todos los estados", value: "all" },
  { label: "Activas", value: "active" },
  { label: "Pausadas", value: "paused" },
];

function StoresList() {
  // Búsqueda, estado, página y tamaño viven en la URL: recarga, "atrás" y volver del detalle los conservan.
  const list = useUrlListState(storesListSchema);
  const { limit, setLimit, setSkip, skip } = useUrlPaginationState(list);
  // El campo refleja lo tecleado al instante; la consulta espera lo mismo que la URL.
  const debouncedSearch = useDebouncedValue(list.state.search, URL_LIST_DEBOUNCE_MS);
  const stores = useStoresList({ ...toStoresFilters(list.state, debouncedSearch), limit, skip });
  const patchStore = usePatchStore();
  const items = getPaginatedItems(stores.data);
  const totalStores = stores.data?.total ?? 0;
  const { setState: setListState } = list;
  const lastPage = getTotalPages(totalStores, limit);
  const isPastLastPage = stores.isSuccess && !stores.isFetching && list.state.page > lastPage;

  // Una página más allá de la última (`?page=9999`, o un enlace viejo) cae en la
  // última que existe, y la URL lo refleja.
  useEffect(() => {
    if (isPastLastPage) {
      setListState({ page: lastPage });
    }
  }, [isPastLastPage, lastPage, setListState]);

  useScrollRestoration(list.href, { ready: !stores.isLoading });

  function handleToggleStatus(store: PlatformStore) {
    void patchStore.mutateAsync({
      id: store.id,
      input: { status: store.status === "active" ? "paused" : "active" },
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        actions={
          <>
            <Input
              aria-label="Buscar tiendas"
              className="sm:w-56"
              onChange={(event) => list.setField("search", event.target.value)}
              placeholder="Buscar por nombre o slug"
              value={list.state.search}
            />
            <SelectField
              aria-label="Filtrar por estado"
              className="sm:w-44"
              onChange={(event) =>
                // El schema valida el valor: uno que no conoce anula el cambio.
                list.setState({ status: event.target.value as StoresListState["status"] })
              }
              options={statusOptions}
              value={list.state.status}
            />
            <Button asChild className="shrink-0">
              <Link href="/platform/stores/new">
                <Plus className="mr-2 size-4" />
                Nueva tienda
              </Link>
            </Button>
          </>
        }
        description="Gestiona las organizaciones de la plataforma."
        title="Tiendas"
      />

      {stores.isLoading || isPastLastPage ? (
        <LoadingState
          description="Cargando el directorio de tiendas."
          title="Cargando tiendas..."
          variant="section"
        />
      ) : stores.error ? (
        <EmptyState
          description={stores.error.message}
          title="No pudimos cargar las tiendas"
        />
      ) : items.length === 0 ? (
        <EmptyState
          action={
            <Button asChild>
              <Link href="/platform/stores/new">
                <Plus className="mr-2 size-4" />
                Nueva tienda
              </Link>
            </Button>
          }
          description="Ajusta los filtros o crea la primera tienda de la plataforma."
          title="No hay tiendas"
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((store) => (
            <StoreCard
              // El detalle vuelve a esta URL exacta (filtros y página) con "Volver".
              detailHref={withReturnTo(`/platform/stores/${store.id}`, list.href)}
              key={store.id}
              onToggleStatus={handleToggleStatus}
              store={store}
            />
          ))}
        </div>
      )}

      {totalStores > 0 && !isPastLastPage ? (
        <ResponsivePagination
          entityLabel="tiendas"
          isDisabled={stores.isFetching}
          limit={limit}
          onLimitChange={setLimit}
          onSkipChange={setSkip}
          skip={stores.data?.skip ?? skip}
          total={totalStores}
        />
      ) : null}
    </div>
  );
}

/** `useUrlListState` lee la URL: la pantalla lleva su límite de Suspense. */
export const StoresListPage = withUrlListBoundary(StoresList);
