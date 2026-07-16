"use client";

import { getPaginatedItems } from "@/lib/api/pagination";
import { SelectField } from "@/shared/components/SelectField";
import { Typography } from "@/shared/components/Typography";

import { useStoresList } from "../hooks/useStores";
import type { PlatformStoreScope } from "../types/reports";

type PlatformStoreScopeFilterProps = {
  description?: string;
  onScopeChange: (scope: PlatformStoreScope) => void;
  onSelectedStoreIdsChange: (storeIds: string[]) => void;
  scope: PlatformStoreScope;
  selectedStoreIds: string[];
  title?: string;
};

export function PlatformStoreScopeFilter({
  description = "Filtra por una tienda, varias seleccionadas o todas.",
  onScopeChange,
  onSelectedStoreIdsChange,
  scope,
  selectedStoreIds,
  title = "Alcance de tiendas",
}: PlatformStoreScopeFilterProps) {
  const stores = useStoresList({ limit: 100 });
  const storeItems = getPaginatedItems(stores.data);

  function toggleStore(storeId: string) {
    if (selectedStoreIds.includes(storeId)) {
      onSelectedStoreIdsChange(selectedStoreIds.filter((id) => id !== storeId));
      return;
    }
    onSelectedStoreIdsChange([...selectedStoreIds, storeId]);
  }

  return (
    <section className="space-y-4 rounded-xl border border-border bg-surface-container-lowest p-4 shadow-sm">
      <div>
        <Typography as="h2" variant="h3">
          {title}
        </Typography>
        <Typography className="mt-1" variant="muted">
          {description}
        </Typography>
      </div>

      <SelectField
        label="Alcance"
        onChange={(event) => {
          const next = event.target.value as PlatformStoreScope;
          onScopeChange(next);
          if (next === "all") {
            onSelectedStoreIdsChange([]);
          }
          if (next === "one" && selectedStoreIds.length > 1) {
            onSelectedStoreIdsChange(selectedStoreIds.slice(0, 1));
          }
        }}
        options={[
          { label: "Todas las tiendas", value: "all" },
          { label: "Una tienda", value: "one" },
          { label: "Tiendas seleccionadas", value: "selected" },
        ]}
        value={scope}
      />

      {scope === "one" ? (
        <SelectField
          label="Tienda"
          onChange={(event) =>
            onSelectedStoreIdsChange(event.target.value ? [event.target.value] : [])
          }
          options={[
            { label: "Selecciona una tienda", value: "" },
            ...storeItems.map((store) => ({
              label: `${store.name} (/${store.slug})`,
              value: store.id,
            })),
          ]}
          value={selectedStoreIds[0] ?? ""}
        />
      ) : null}

      {scope === "selected" ? (
        <div className="space-y-2">
          <Typography variant="caption">Tiendas</Typography>
          {stores.isLoading ? (
            <Typography variant="muted">Cargando tiendas...</Typography>
          ) : storeItems.length === 0 ? (
            <Typography variant="muted">No hay tiendas disponibles.</Typography>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {storeItems.map((store) => {
                const checked = selectedStoreIds.includes(store.id);
                return (
                  <li key={store.id}>
                    <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border px-3 py-2 hover:bg-surface-container-low">
                      <input
                        checked={checked}
                        className="mt-1"
                        onChange={() => toggleStore(store.id)}
                        type="checkbox"
                      />
                      <span>
                        <span className="block text-sm font-medium text-foreground">
                          {store.name}
                        </span>
                        <span className="text-xs text-muted-foreground">/{store.slug}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
