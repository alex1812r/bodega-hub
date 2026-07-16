"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { getPaginatedItems } from "@/lib/api/pagination";
import { Button } from "@/shared/components/Button";
import { EmptyState } from "@/shared/components/EmptyState";
import { Input } from "@/shared/components/Input";
import { LoadingState } from "@/shared/components/LoadingState";
import { PageHeader } from "@/shared/components/PageHeader";
import { SelectField } from "@/shared/components/SelectField";

import { usePatchStore, useStoresList } from "../hooks/useStores";
import type { PlatformStore } from "../types/stores";
import { StoreCard } from "./components/StoreCard";

export function StoresListPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"active" | "paused" | "">("");
  const stores = useStoresList({
    search,
    status: status || undefined,
  });
  const patchStore = usePatchStore();
  const items = getPaginatedItems(stores.data);

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
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por nombre o slug"
              value={search}
            />
            <SelectField
              aria-label="Filtrar por estado"
              className="sm:w-44"
              onChange={(event) => setStatus(event.target.value as "active" | "paused" | "")}
              options={[
                { label: "Todos los estados", value: "" },
                { label: "Activas", value: "active" },
                { label: "Pausadas", value: "paused" },
              ]}
              value={status}
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

      {stores.isLoading ? (
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
              key={store.id}
              onToggleStatus={handleToggleStatus}
              store={store}
            />
          ))}
        </div>
      )}
    </div>
  );
}
