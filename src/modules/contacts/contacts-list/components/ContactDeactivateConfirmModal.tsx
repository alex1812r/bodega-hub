"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { MAX_PAGE_LIMIT } from "@/lib/api/pagination";
import { apiFetch } from "@/shared/api/apiFetch";
import {
  ConfirmActionModal,
  type ConfirmActionEffect,
  type ConfirmActionStatus,
} from "@/shared/components/ConfirmActionModal";
import type { ContactMock } from "@/shared/mocks/erp-data";

import { contactsQueryKeys } from "../../hooks/useContacts";
import { supplierProductsQueryKeys, useSupplierProducts } from "../../hooks/useSupplierProducts";

type ContactDeactivateConfirmModalProps = {
  /** El contacto activo que se va a desactivar. `null` cierra el modal. */
  contact: ContactMock | null;
  onOpenChange: (open: boolean) => void;
};

type PreferredSummary = {
  /** Productos de los que es el proveedor habitual, entre los vínculos leídos. */
  count: number;
  /** Hay más vínculos de los que caben en una página: la cuenta es un mínimo. */
  isPartial: boolean;
};

function isSupplier(contact: ContactMock | null) {
  return contact?.type === "proveedor" || contact?.type === "ambos";
}

function describePreferredCount({ count, isPartial }: PreferredSummary) {
  const products = count === 1 ? "1 producto" : `${String(count)} productos`;

  return isPartial ? `Al menos ${products}` : products;
}

/**
 * Lo que pasa de verdad al desactivar: el contacto queda inactivo y nada de su
 * historial se borra. Si es proveedor, el trigger
 * `trg_contacts_release_preferred_supplier` le quita el «habitual» de todos sus
 * productos y lo pasa a otro proveedor activo de cada uno cuando lo hay; con
 * eso cambia el costo que se sugiere al comprar. Reactivarlo no se lo devuelve.
 */
export function buildContactDeactivateEffects(
  preferred: PreferredSummary | null,
): ConfirmActionEffect[] {
  const effects: ConfirmActionEffect[] = [
    { after: "Inactivo", before: "Activo", label: "Estado del contacto", tone: "warning" },
  ];

  if (preferred && (preferred.count > 0 || preferred.isPartial)) {
    effects.push(
      {
        after: "Deja de serlo",
        before: describePreferredCount(preferred),
        label: "Proveedor habitual",
        tone: "warning",
      },
      {
        label:
          "El habitual de cada producto pasa a otro proveedor activo; si no hay ninguno, queda sin habitual. Reactivar el contacto no se lo devuelve",
        tone: "warning",
      },
    );
  } else if (preferred) {
    effects.push({ label: "No es el proveedor habitual de ningún producto" });
  }

  effects.push({ label: "Sus ventas, compras, pagos y saldos se conservan" });

  return effects;
}

export function ContactDeactivateConfirmModal({
  contact,
  onOpenChange,
}: ContactDeactivateConfirmModalProps) {
  const queryClient = useQueryClient();
  const supplier = isSupplier(contact);
  const links = useSupplierProducts(supplier ? contact?.id : undefined, { limit: MAX_PAGE_LIMIT });
  const deactivate = useMutation({
    mutationFn: (contactId: string) =>
      apiFetch(`/api/contacts/${contactId}`, { body: { isActive: false }, method: "PATCH" }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: contactsQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: supplierProductsQueryKeys.all }),
      ]),
  });

  const preferred: PreferredSummary | null =
    supplier && links.data
      ? {
          count: links.data.items.filter((link) => link.isPreferred).length,
          isPartial: links.data.total > links.data.items.length,
        }
      : null;
  let status: ConfirmActionStatus = "ready";

  // Sin los vínculos de un proveedor no hay efecto que enseñar: no se confirma a ciegas.
  if (supplier && !links.data) {
    status = links.error ? "error" : "loading";
  }

  function handleOpenChange(open: boolean) {
    if (!open) {
      deactivate.reset();
    }

    onOpenChange(open);
  }

  async function handleConfirm() {
    if (!contact) {
      return;
    }

    try {
      await deactivate.mutateAsync(contact.id);
    } catch {
      // El motivo queda en `deactivate.error` y se muestra en el diálogo.
      return;
    }

    handleOpenChange(false);
  }

  return (
    <ConfirmActionModal
      confirmLabel="Desactivar contacto"
      description="El contacto queda inactivo. Puedes reactivarlo desde esta lista."
      effects={buildContactDeactivateEffects(preferred)}
      error={deactivate.error instanceof Error ? deactivate.error.message : null}
      isPending={deactivate.isPending}
      onConfirm={handleConfirm}
      onOpenChange={handleOpenChange}
      onRetry={() => void links.refetch()}
      open={contact !== null}
      status={status}
      statusHint={status === "loading" ? undefined : "No se ha cambiado nada."}
      statusMessage={
        status === "error"
          ? links.error?.message || "No se pudieron cargar los productos del proveedor."
          : "Cargando los productos del proveedor…"
      }
      title="Confirmar desactivación"
      variant="danger"
    >
      <p>
        <span className="break-words font-medium text-foreground">{contact?.name}</span>
        {contact?.taxId ? ` (${contact.taxId})` : ""} quedará inactivo.
      </p>
    </ConfirmActionModal>
  );
}
