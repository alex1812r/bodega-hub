"use client";

import { useQueryClient } from "@tanstack/react-query";

import type { PaginatedList } from "@/lib/api/pagination";
import { useContact } from "@/modules/contacts/hooks/useContacts";
import { usePurchase } from "@/modules/purchases/hooks/usePurchases";
import { useSale } from "@/modules/sales/hooks/useSales";

import { paymentsQueryKeys, type PaymentListItem } from "../../hooks/usePayments";
import { formatPurchaseNumberDisplay } from "../utils/paymentReference";

export type PaymentsFilterChipKey = "contactId" | "purchaseId" | "saleId";

export type PaymentsFilterChip = {
  key: PaymentsFilterChipKey;
  /** Texto humano; mientras no se conoce, un texto neutro (nunca el id). */
  label: string;
};

type DeepLinkFilters = {
  contactId?: string;
  purchaseId?: string;
  saleId?: string;
};

/**
 * Chips de los filtros de enlace profundo (`saleId`, `purchaseId`, `contactId`).
 * El número del documento y el nombre del contacto salen de los pagos que la
 * lista ya trajo (cualquier página en caché); si esos pagos no lo traen (lista
 * vacía), se pide el documento o el contacto con su hook de detalle.
 *
 * `listSettled`: la página actual ya respondió; antes no se pide nada aparte.
 */
export function usePaymentsFilterChips(
  filters: DeepLinkFilters,
  listSettled: boolean,
): PaymentsFilterChip[] {
  const queryClient = useQueryClient();
  const knownPayments = queryClient
    .getQueriesData<PaginatedList<PaymentListItem>>({
      queryKey: [...paymentsQueryKeys.all, "list"],
    })
    .flatMap(([, page]) => page?.items ?? []);

  const saleNumberFromList = filters.saleId
    ? knownPayments.find(
        (payment) => payment.saleId === filters.saleId && payment.relatedDocument,
      )?.relatedDocument?.label
    : undefined;
  const purchaseNumberFromList = filters.purchaseId
    ? knownPayments.find(
        (payment) => payment.purchaseId === filters.purchaseId && payment.relatedDocument,
      )?.relatedDocument?.label
    : undefined;
  const contactNameFromList = filters.contactId
    ? knownPayments.find(
        (payment) => payment.contactId === filters.contactId && payment.contact?.name,
      )?.contact?.name
    : undefined;

  const sale = useSale(listSettled && !saleNumberFromList ? filters.saleId : undefined);
  const purchase = usePurchase(
    listSettled && !purchaseNumberFromList ? filters.purchaseId : undefined,
  );
  const contact = useContact(
    listSettled && !contactNameFromList ? filters.contactId : undefined,
  );

  const saleNumber = saleNumberFromList ?? sale.data?.invoiceNumber;
  const purchaseNumber =
    purchaseNumberFromList ??
    (purchase.data?.purchaseNumber
      ? formatPurchaseNumberDisplay(purchase.data.purchaseNumber)
      : undefined);
  const contactName = contactNameFromList ?? contact.data?.name;

  const chips: PaymentsFilterChip[] = [];

  if (filters.saleId) {
    chips.push({
      key: "saleId",
      label: saleNumber ? `Venta ${saleNumber}` : "Venta seleccionada",
    });
  }

  if (filters.purchaseId) {
    chips.push({
      key: "purchaseId",
      label: purchaseNumber ? `Compra ${purchaseNumber}` : "Compra seleccionada",
    });
  }

  if (filters.contactId) {
    chips.push({
      key: "contactId",
      label: contactName ? `Contacto: ${contactName}` : "Contacto seleccionado",
    });
  }

  return chips;
}
