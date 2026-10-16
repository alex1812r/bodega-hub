"use client";

import { ScanText, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { ClientApiError } from "@/shared/api/apiFetch";
import { usePermission } from "@/shared/auth/usePermission";
import { Button } from "@/shared/components/Button";
import { useToast } from "@/shared/components/Toast";
import { formatDateTimeShort } from "@/shared/utils/date";

import {
  useRemoveSupplierProductAlias,
  useSupplierProductAliases,
} from "../../hooks/useSupplierProductAliases";

import type { SupplierProductAlias } from "../../types/supplierProductAliases";

type SupplierProductAliasesSectionProps = {
  /** Enlace a la ficha del producto (con el `returnTo` del listado). */
  productHref: (productId: string) => string;
  supplierId: string;
};

type AliasGroup = {
  aliases: SupplierProductAlias[];
  productId: string;
  productName: string;
};

export const SUPPLIER_ALIASES_EMPTY_MESSAGE = "Aún no hay alias aprendidos de facturas";

/** "Bulto × 12", "Bulto", "Empaque × 12" o "Por unidad". */
export function formatAliasPack(alias: Pick<SupplierProductAlias, "packLabel" | "unitsPerPack">) {
  const label = alias.packLabel?.trim();

  if (label && alias.unitsPerPack) return `${label} × ${alias.unitsPerPack}`;
  if (label) return label;
  if (alias.unitsPerPack) return `Empaque × ${alias.unitsPerPack}`;

  return "Por unidad";
}

function formatHits(hits: number) {
  return hits === 1 ? "Visto 1 vez" : `Visto ${hits} veces`;
}

function productLabel(alias: SupplierProductAlias) {
  return alias.productName ?? alias.productId;
}

/** Agrupa por producto los de la lista del proveedor; el resto va a "Otros alias". */
function groupAliases(items: SupplierProductAlias[]) {
  const groups = new Map<string, AliasGroup>();
  const others: SupplierProductAlias[] = [];

  for (const alias of items) {
    if (!alias.inSupplierProducts) {
      others.push(alias);
      continue;
    }

    const group = groups.get(alias.productId) ?? {
      aliases: [],
      productId: alias.productId,
      productName: productLabel(alias),
    };
    group.aliases.push(alias);
    groups.set(alias.productId, group);
  }

  const linked = [...groups.values()].sort((a, b) => a.productName.localeCompare(b.productName, "es"));

  return { linked, others };
}

/**
 * SCN-09b · Alias que el escaneo de facturas aprendió para este proveedor, por
 * producto, con "Quitar alias" para quien puede registrar compras. Quitar es una
 * acción directa con aviso (sin confirmación): no toca stock ni dinero y el alias
 * se vuelve a aprender si se confirma otra factura con ese texto.
 */
export function SupplierProductAliasesSection({ productHref, supplierId }: SupplierProductAliasesSectionProps) {
  const { can } = usePermission();
  const canView = can("purchases.view");
  const canRemove = can("purchases.create");
  const { showToast } = useToast();
  const query = useSupplierProductAliases(supplierId, { enabled: canView });
  const removeAlias = useRemoveSupplierProductAlias(supplierId);
  const [pendingId, setPendingId] = useState<string | null>(null);

  if (!canView) {
    return null;
  }

  async function handleRemove(alias: SupplierProductAlias) {
    setPendingId(alias.id);

    try {
      await removeAlias.mutateAsync(alias.id);
      showToast({
        description: "Si confirmas otra factura con ese texto se volverá a aprender.",
        title: `Alias quitado: «${alias.aliasNorm}»`,
        tone: "success",
      });
    } catch (error) {
      const gone = error instanceof ClientApiError && error.status === 404;

      showToast({
        description: gone ? "Ya no estaba en la lista; se actualizó." : undefined,
        title: gone
          ? "El alias ya no existe"
          : error instanceof Error && error.message
            ? error.message
            : "No se pudo quitar el alias",
        tone: gone ? "info" : "error",
      });
    } finally {
      setPendingId(null);
    }
  }

  const items = query.data?.items ?? [];
  const { linked, others } = groupAliases(items);

  function renderAlias(alias: SupplierProductAlias, showProduct: boolean) {
    const isPending = pendingId === alias.id;

    return (
      <li
        className="flex flex-col gap-2 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
        data-testid="supplier-alias"
        key={alias.id}
      >
        <div className="min-w-0 space-y-1">
          <p className="break-words font-mono text-sm text-foreground">{alias.aliasNorm}</p>
          {showProduct ? (
            <p className="text-xs text-on-surface-variant">
              Producto:{" "}
              <Link
                className="font-medium text-primary hover:underline dark:text-indigo-300"
                href={productHref(alias.productId)}
              >
                {productLabel(alias)}
              </Link>
            </p>
          ) : null}
          <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-on-surface-variant">
            <span>{formatAliasPack(alias)}</span>
            <span>{formatHits(alias.hits)}</span>
            <span>Última vez {formatDateTimeShort(alias.lastSeenAt)}</span>
          </p>
        </div>
        {canRemove ? (
          <Button
            aria-label={`Quitar alias «${alias.aliasNorm}»`}
            className="w-full shrink-0 gap-1 text-red-700 hover:bg-red-50 sm:w-auto dark:text-red-300 dark:hover:bg-red-950"
            disabled={isPending}
            onClick={() => void handleRemove(alias)}
            size="sm"
            type="button"
            variant="ghost"
          >
            <X aria-hidden className="size-4" />
            {isPending ? "Quitando…" : "Quitar alias"}
          </Button>
        ) : null}
      </li>
    );
  }

  return (
    <section aria-labelledby="supplier-aliases-title" className="space-y-3 border-t border-outline-variant pt-4">
      <div>
        <h3 className="flex items-center gap-2 text-base font-semibold text-foreground" id="supplier-aliases-title">
          <ScanText aria-hidden className="size-5 text-on-surface-variant" />
          Alias aprendidos de facturas
        </h3>
        <p className="text-sm text-on-surface-variant">
          Textos de factura de este proveedor que el escaneo ya reconoce como un producto.
        </p>
      </div>

      {query.isLoading ? (
        <p aria-live="polite" className="text-sm text-on-surface-variant">
          Cargando alias…
        </p>
      ) : query.error ? (
        <div className="flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 sm:flex-row sm:items-center sm:justify-between dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          <span>No se pudieron cargar los alias.</span>
          <Button onClick={() => void query.refetch()} size="sm" type="button" variant="secondary">
            Reintentar
          </Button>
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-outline-variant px-3 py-4 text-center text-sm text-on-surface-variant">
          {SUPPLIER_ALIASES_EMPTY_MESSAGE}
        </p>
      ) : (
        <div className="space-y-4">
          {linked.map((group) => (
            <div aria-label={`Alias de ${group.productName}`} className="space-y-2" key={group.productId} role="group">
              <Link
                className="text-sm font-medium text-primary hover:underline dark:text-indigo-300"
                href={productHref(group.productId)}
              >
                {group.productName}
              </Link>
              <ul className="space-y-2">{group.aliases.map((alias) => renderAlias(alias, false))}</ul>
            </div>
          ))}
          {others.length > 0 ? (
            <div aria-label="Otros alias" className="space-y-2" role="group">
              <div>
                <p className="text-sm font-medium text-foreground">Otros alias</p>
                <p className="text-xs text-on-surface-variant">
                  Productos que no están en la lista de este proveedor.
                </p>
              </div>
              <ul className="space-y-2">{others.map((alias) => renderAlias(alias, true))}</ul>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
