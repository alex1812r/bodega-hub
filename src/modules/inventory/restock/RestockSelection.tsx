"use client";

import { Lock } from "lucide-react";
import { useId, useMemo, useState } from "react";

import { ClientApiError } from "@/shared/api/apiFetch";
import { Button } from "@/shared/components/Button";
import { EmptyState } from "@/shared/components/EmptyState";
import { ErrorState } from "@/shared/components/ErrorState";
import { LoadingState } from "@/shared/components/LoadingState";
import { NumberInput } from "@/shared/components/NumberInput";
import { useToast } from "@/shared/components/Toast";
import { useProcessGuard } from "@/shared/hooks/useProcessGuard";
import { cn } from "@/shared/utils/cn";

import type { InventoryOverviewItem } from "../hooks/useInventory";
import { getInventoryStockStatus, inventoryStockStatusLabels } from "../utils/inventoryStockStatus";
import {
  buildRestockPurchaseHref,
  RESTOCK_DRAFT_MAX_LINES,
  saveRestockDraft,
} from "./restockDraft";
import {
  getRestockGroupLabel,
  groupRestockLines,
  isValidRestockQuantity,
  suggestRestockQuantity,
  type RestockGroupEntry,
} from "./restockPlan";
import {
  useRestockCandidates,
  useRestockSession,
  useRestockSuppliers,
  type RestockSupplierState,
} from "./useRestockData";

export const RESTOCK_CREATE_LABEL = "Crear compra con estos productos";

const checkboxClassName =
  "size-4 shrink-0 cursor-pointer rounded border-outline accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

type RestockSelectionProps = {
  className?: string;
  /** Se llama justo antes de navegar a la compra (p. ej. para cerrar el modal). */
  onCreated?: () => void;
};

function SupplierCell({ state }: { state: RestockSupplierState | undefined }) {
  if (!state) {
    return <span className="text-on-surface-variant">Se consulta al seleccionarlo</span>;
  }

  if (state.status === "loading") {
    return (
      <span className="text-on-surface-variant" role="status">
        Consultando proveedor…
      </span>
    );
  }

  if (state.status === "error") {
    return (
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-error">
        No se pudo consultar el proveedor.
        <button
          className="cursor-pointer rounded font-medium text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={state.retry}
          type="button"
        >
          Reintentar
        </button>
      </span>
    );
  }

  return state.supplier ? (
    <span className="font-medium text-foreground">{state.supplier.name}</span>
  ) : (
    <span className="text-on-surface-variant">Sin proveedor</span>
  );
}

/**
 * Reposición (INV-05): lista los productos con stock bajo o agotado, deja
 * elegir cuáles pedir y cuánto, los reparte por proveedor (una compra = un
 * proveedor) y abre `/purchases/create?restock=<id>` con las líneas de UN
 * proveedor precargadas. No pinta nada sin permiso: lo decide quien lo monta
 * (`RestockPurchaseButton`).
 */
export function RestockSelection({ className, onCreated }: RestockSelectionProps) {
  const fieldId = useId();
  const candidates = useRestockCandidates();
  const session = useRestockSession();
  const { showToast } = useToast();
  // Sin proceso propio que proteger: solo respeta a otro guardia activo en la pantalla.
  const { guardedNavigate } = useProcessGuard({
    active: false,
    label: "Reposición",
    onLeave: "discard",
  });
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  // Cantidades tocadas a mano; `null` = campo vacío. Sin entrada vale la sugerida.
  const [quantities, setQuantities] = useState<Record<string, number | null>>({});
  const [chosenGroupKey, setChosenGroupKey] = useState<string | null>(null);

  const pages = candidates.data?.pages;
  const items = useMemo(() => {
    const byId = new Map<string, InventoryOverviewItem>();

    // Si el stock cambia entre dos cargas, un producto puede venir repetido.
    for (const page of pages ?? []) {
      for (const item of page.items) {
        if (!byId.has(item.id)) {
          byId.set(item.id, item);
        }
      }
    }

    return [...byId.values()];
  }, [pages]);
  const total = Math.max(pages?.[pages.length - 1]?.total ?? 0, items.length);

  const selectedItems = items.filter((item) => selectedIds.has(item.id));
  const suppliers = useRestockSuppliers(selectedItems.map((item) => item.id));

  function quantityOf(item: InventoryOverviewItem) {
    return item.id in quantities
      ? quantities[item.id]
      : suggestRestockQuantity(item.minStock, item.currentStock);
  }

  const entries: RestockGroupEntry[] = [];
  let pendingSuppliers = 0;
  let failedSuppliers = 0;
  let invalidQuantities = 0;

  for (const item of selectedItems) {
    const state = suppliers.get(item.id);
    const quantity = quantityOf(item);

    if (!isValidRestockQuantity(quantity)) {
      invalidQuantities += 1;
    }

    if (!state || state.status === "loading") {
      pendingSuppliers += 1;
    } else if (state.status === "error") {
      failedSuppliers += 1;
    } else if (isValidRestockQuantity(quantity)) {
      const { supplier } = state;

      entries.push({
        line: {
          currentStock: item.currentStock,
          ...(supplier?.lastCostRef !== undefined ? { lastCostRef: supplier.lastCostRef } : {}),
          minStock: item.minStock,
          name: item.name,
          productId: item.id,
          sku: item.sku,
          suggestedQuantity: quantity,
        },
        supplier: supplier ? { id: supplier.id, name: supplier.name } : null,
      });
    }
  }

  const groups = groupRestockLines(entries);
  const activeGroup =
    groups.length === 1
      ? groups[0]
      : (groups.find((group) => group.key === chosenGroupKey) ?? null);
  const tooManyLines = (activeGroup?.lines.length ?? 0) > RESTOCK_DRAFT_MAX_LINES;

  const blocker =
    selectedItems.length === 0
      ? "Selecciona al menos un producto."
      : invalidQuantities > 0
        ? "Corrige las cantidades: deben ser enteros de 1 en adelante."
        : pendingSuppliers > 0
          ? "Consultando proveedores…"
          : groups.length === 0
            ? "No se pudo consultar el proveedor de los productos seleccionados."
            : activeGroup === null
              ? "Elige con qué proveedor crear la compra ahora."
              : tooManyLines
                ? `Una compra admite hasta ${RESTOCK_DRAFT_MAX_LINES} productos: quita algunos.`
                : session === null
                  ? "Cargando tu sesión…"
                  : null;

  const allSelected = items.length > 0 && selectedItems.length === items.length;

  function toggleAll(checked: boolean) {
    setSelectedIds(checked ? new Set(items.map((item) => item.id)) : new Set());
  }

  function toggleOne(productId: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);

      if (checked) {
        next.add(productId);
      } else {
        next.delete(productId);
      }

      return next;
    });
  }

  function handleCreate() {
    if (blocker !== null || activeGroup === null) {
      return;
    }

    const id = saveRestockDraft(
      {
        lines: activeGroup.lines,
        ...(activeGroup.supplier ? { supplier: activeGroup.supplier } : {}),
      },
      session,
    );

    if (id === null) {
      showToast({
        description: "El navegador no dejó guardar la selección. Inténtalo de nuevo.",
        title: "No se pudo preparar la compra",
        tone: "error",
      });
      return;
    }

    onCreated?.();
    guardedNavigate(buildRestockPurchaseHref(id));
  }

  if (candidates.isLoading) {
    return (
      <LoadingState
        className={className}
        description="Productos con stock bajo o agotado."
        title="Cargando productos por reponer..."
      />
    );
  }

  if (candidates.error && items.length === 0) {
    const isForbidden =
      candidates.error instanceof ClientApiError && candidates.error.status === 403;

    return isForbidden ? (
      <EmptyState
        className={className}
        description="Pide al administrador de la tienda el permiso para consultar el inventario."
        icon={<Lock aria-hidden className="h-5 w-5" />}
        title="No tienes permiso para ver el inventario"
      />
    ) : (
      <div className={className}>
        <ErrorState
          description="Revisa tu conexión e inténtalo de nuevo."
          onRetry={() => void candidates.refetch()}
          title="No pudimos cargar los productos por reponer"
        />
      </div>
    );
  }

  if (items.length === 0) {
    return <EmptyState className={className} title="No hay productos por reponer." />;
  }

  return (
    <div className={cn("flex flex-col gap-4 text-sm text-foreground", className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <label className="flex cursor-pointer items-center gap-2 font-medium">
          <input
            checked={allSelected}
            className={checkboxClassName}
            onChange={(event) => toggleAll(event.target.checked)}
            ref={(input) => {
              if (input) {
                input.indeterminate = selectedItems.length > 0 && !allSelected;
              }
            }}
            type="checkbox"
          />
          Seleccionar todos
        </label>
        <p aria-live="polite" className="tabular-nums text-on-surface-variant">
          {selectedItems.length === 1 ? "1 seleccionado" : `${selectedItems.length} seleccionados`}
        </p>
      </div>

      <ul
        aria-label="Productos por reponer"
        className="divide-y divide-border rounded-xl border border-border"
      >
        {items.map((item) => {
          const isSelected = selectedIds.has(item.id);
          const quantity = quantityOf(item);
          const checkboxId = `${fieldId}-check-${item.id}`;
          const status = getInventoryStockStatus(item);

          return (
            <li
              className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 p-3 sm:grid-cols-[auto_minmax(0,1fr)_7rem_minmax(0,11rem)] sm:items-center"
              key={item.id}
            >
              <input
                aria-label={`Seleccionar ${item.name}`}
                checked={isSelected}
                className={cn(checkboxClassName, "mt-1 sm:mt-0")}
                id={checkboxId}
                onChange={(event) => toggleOne(item.id, event.target.checked)}
                type="checkbox"
              />
              <div className="min-w-0">
                <label className="block cursor-pointer break-words font-medium" htmlFor={checkboxId}>
                  {item.name}
                </label>
                <p className="break-words text-xs text-on-surface-variant">
                  {item.sku} · Stock {item.currentStock} · Mínimo {item.minStock} ·{" "}
                  {inventoryStockStatusLabels[status]}
                </p>
              </div>
              <div className="col-start-2 sm:col-start-auto">
                <NumberInput
                  aria-label={`Cantidad a pedir de ${item.name}`}
                  decimals={0}
                  disabled={!isSelected}
                  error={
                    isSelected && !isValidRestockQuantity(quantity)
                      ? "Entero de 1 en adelante."
                      : undefined
                  }
                  onValueChange={(value) =>
                    setQuantities((current) => ({ ...current, [item.id]: value }))
                  }
                  value={quantity}
                />
              </div>
              <div className="col-start-2 min-w-0 break-words text-xs sm:col-start-auto sm:text-sm">
                <span className="sr-only">Proveedor: </span>
                <SupplierCell state={isSelected ? suppliers.get(item.id) : undefined} />
              </div>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="text-on-surface-variant" role="status">
          {items.length < total
            ? `Mostrando ${items.length} de ${total} productos por reponer. "Seleccionar todos" solo marca los que se muestran.`
            : total === 1
              ? "1 producto por reponer."
              : `${total} productos por reponer.`}
        </p>
        {candidates.hasNextPage ? (
          <Button
            disabled={candidates.isFetchingNextPage}
            onClick={() => void candidates.fetchNextPage()}
            size="sm"
            type="button"
            variant="outline"
          >
            {candidates.isFetchingNextPage ? "Cargando…" : "Cargar más"}
          </Button>
        ) : null}
      </div>
      {candidates.error ? (
        <p className="text-error" role="alert">
          No pudimos cargar más productos. Inténtalo de nuevo.
        </p>
      ) : null}

      <section
        aria-label="Resumen por proveedor"
        className="rounded-xl border border-border bg-surface-container-low p-3"
      >
        <h3 className="font-semibold">Resumen por proveedor</h3>
        {groups.length === 0 ? (
          <p className="mt-1 text-on-surface-variant">
            Cada compra es de un solo proveedor: aquí verás cómo se reparten los productos que
            selecciones.
          </p>
        ) : (
          <>
            {groups.length > 1 ? (
              <p className="mt-1 text-on-surface-variant">
                La selección abarca {groups.length} proveedores y cada compra es de uno solo. Elige
                con cuál crear la compra ahora; después vuelve por los demás.
              </p>
            ) : null}
            <ul className="mt-2 flex flex-col gap-2">
              {groups.map((group) => {
                const label = getRestockGroupLabel(group);
                const detail = `${group.lines.length === 1 ? "1 producto" : `${group.lines.length} productos`} · ${group.totalUnits === 1 ? "1 unidad" : `${group.totalUnits} unidades`}`;

                return (
                  <li key={group.key}>
                    {groups.length > 1 ? (
                      <label className="flex cursor-pointer items-start gap-2">
                        <input
                          checked={chosenGroupKey === group.key}
                          className="mt-0.5 size-4 shrink-0 cursor-pointer accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          name={`${fieldId}-group`}
                          onChange={() => setChosenGroupKey(group.key)}
                          type="radio"
                        />
                        <span className="min-w-0 break-words">
                          <span className="font-medium">{label}</span>
                          <span className="text-on-surface-variant"> · {detail}</span>
                        </span>
                      </label>
                    ) : (
                      <p className="break-words">
                        <span className="font-medium">{label}</span>
                        <span className="text-on-surface-variant"> · {detail}</span>
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
            {activeGroup !== null && activeGroup.supplier === null ? (
              <p className="mt-2 text-on-surface-variant">
                Estos productos no tienen proveedor habitual ni compras previas: lo eliges en la
                pantalla de compra.
              </p>
            ) : null}
          </>
        )}
        {failedSuppliers > 0 ? (
          <p className="mt-2 text-error" role="alert">
            {failedSuppliers === 1
              ? "1 producto seleccionado no entra en ninguna compra: no se pudo consultar su proveedor."
              : `${failedSuppliers} productos seleccionados no entran en ninguna compra: no se pudo consultar su proveedor.`}
          </p>
        ) : null}
      </section>

      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
        {blocker !== null ? (
          <p className="text-on-surface-variant sm:mr-auto" id={`${fieldId}-blocker`}>
            {blocker}
          </p>
        ) : null}
        <Button
          aria-describedby={blocker !== null ? `${fieldId}-blocker` : undefined}
          disabled={blocker !== null}
          onClick={handleCreate}
          type="button"
        >
          {RESTOCK_CREATE_LABEL}
        </Button>
      </div>
    </div>
  );
}
