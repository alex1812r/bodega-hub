"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { MAX_PAGE_LIMIT } from "@/lib/api/pagination";
import { ContactSettlementModal } from "@/modules/payments/components/ContactSettlementModal";
import { RegisterPaymentModal } from "@/modules/payments/components/RegisterPaymentModal";
import {
  type OpenDocument,
  type OpenDocumentType,
  useOpenDocuments,
} from "@/modules/payments/hooks/useOpenDocuments";
import { formatPurchaseNumberDisplay } from "@/modules/payments/payments-list/utils/paymentReference";
import { canViewPurchasePayments } from "@/shared/auth/paymentAccess";
import type { Permission, UserRole } from "@/shared/auth/permissions";
import { Button } from "@/shared/components/Button";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { EmptyState } from "@/shared/components/EmptyState";
import type { ContactType } from "@/shared/mocks/erp-data";
import { formatRefUsd, formatVesBs, roundMoney } from "@/shared/utils/currency";
import { formatDate } from "@/shared/utils/date";
import { withReturnTo } from "@/shared/utils/returnTo";

type BalanceAccess = {
  can: (permission: Permission) => boolean;
  role?: UserRole;
};

/**
 * Secciones de saldos que este usuario puede ver de un contacto, en el orden en que
 * se pintan. Misma regla que `GET /api/payments/open-documents` y `POST /api/payments`:
 * las ventas se cobran con `payments.manage` o `sales.create`; las compras exigen
 * `payments.manage`, un rol que vea pagos de compra y `purchases.view`. Una lista
 * vacía significa que la pestaña "Saldos" no debe pintarse.
 */
export function getContactBalanceSections(
  contactType: ContactType,
  { can, role }: BalanceAccess,
): OpenDocumentType[] {
  const sections: OpenDocumentType[] = [];
  const canManagePayments = can("payments.manage");

  if (contactType !== "proveedor" && (canManagePayments || can("sales.create"))) {
    sections.push("sale");
  }

  if (
    contactType !== "cliente" &&
    canManagePayments &&
    role !== undefined &&
    canViewPurchasePayments(role) &&
    can("purchases.view")
  ) {
    sections.push("purchase");
  }

  return sections;
}

const sectionCopy = {
  purchase: {
    documentHeader: "Compra",
    documentsLabel: (count: number) => (count === 1 ? "1 compra" : `${count} compras`),
    rowAction: "Pagar",
    title: "Por pagar",
  },
  sale: {
    documentHeader: "Venta",
    documentsLabel: (count: number) => (count === 1 ? "1 venta" : `${count} ventas`),
    rowAction: "Cobrar",
    title: "Por cobrar",
  },
} as const;

function documentNumber(document: OpenDocument) {
  return document.type === "purchase"
    ? formatPurchaseNumberDisplay(document.number)
    : document.number;
}

function documentHref(document: OpenDocument) {
  const base = document.type === "purchase" ? "/purchases" : "/sales";

  return `${base}/${encodeURIComponent(document.id)}`;
}

function Money({ refAmount, ves }: { refAmount?: number; ves: number }) {
  return (
    <span className="inline-flex flex-col items-end tabular-nums">
      {refAmount === undefined ? null : (
        <span className="font-medium">{formatRefUsd(refAmount)}</span>
      )}
      <span className={refAmount === undefined ? "font-medium" : "text-xs text-on-surface-variant"}>
        {formatVesBs(ves)}
      </span>
    </span>
  );
}

type ContactBalancesSectionProps = {
  contactId: string;
  contactName: string;
  returnHref: string;
  type: OpenDocumentType;
};

function ContactBalancesSection({
  contactId,
  contactName,
  returnHref,
  type,
}: ContactBalancesSectionProps) {
  const copy = sectionCopy[type];
  const [payingDocumentId, setPayingDocumentId] = useState<string>();
  const openDocuments = useOpenDocuments(
    { contactId, limit: MAX_PAGE_LIMIT, type },
    { enabled: Boolean(contactId) },
  );
  const documents = openDocuments.data?.items ?? [];
  const totals = openDocuments.data?.totals;
  const isIncomplete =
    Boolean(totals?.truncated) || (totals !== undefined && totals.count > documents.length);

  const columns = useMemo<DataTableColumn<OpenDocument>[]>(
    () => [
      {
        header: copy.documentHeader,
        hideInCard: true,
        key: "number",
        render: (row) => (
          <Link
            className="rounded font-mono text-[13px] text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={withReturnTo(documentHref(row), returnHref)}
          >
            {documentNumber(row)}
          </Link>
        ),
      },
      { header: "Fecha", key: "createdAt", render: (row) => formatDate(row.createdAt) },
      {
        align: "right",
        header: "Total",
        key: "total",
        render: (row) => <Money refAmount={row.totalRef} ves={row.totalVes} />,
      },
      {
        align: "right",
        header: "Pagado",
        key: "paid",
        render: (row) => <Money refAmount={row.paidRef} ves={row.paidVes} />,
      },
      {
        align: "right",
        header: "Saldo",
        key: "pending",
        render: (row) => <Money refAmount={row.pendingRef} ves={row.pendingVes} />,
      },
      {
        align: "right",
        header: "Acción",
        key: "action",
        render: (row) => (
          <Button
            aria-label={`${copy.rowAction} ${documentNumber(row)}`}
            onClick={() => setPayingDocumentId(row.id)}
            size="sm"
            type="button"
            variant="secondary"
          >
            {copy.rowAction}
          </Button>
        ),
      },
    ],
    [copy, returnHref],
  );

  return (
    <section aria-label={copy.title} className="flex flex-col">
      <header className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-on-surface">{copy.title}</h3>
          {totals ? (
            <p className="mt-1 text-sm text-on-surface-variant">
              <span className="font-semibold tabular-nums text-on-surface">
                {totals.pendingRef === undefined
                  ? formatVesBs(roundMoney(totals.pendingVes))
                  : `${formatRefUsd(roundMoney(totals.pendingRef))} · ${formatVesBs(roundMoney(totals.pendingVes))}`}
              </span>{" "}
              en {copy.documentsLabel(totals.count)}
            </p>
          ) : null}
        </div>
        {documents.length > 0 ? (
          <ContactSettlementModal
            contactId={contactId}
            contactName={contactName}
            trigger={
              <Button className="w-full sm:w-auto" size="sm" type="button">
                Abonar
              </Button>
            }
            type={type}
          />
        ) : null}
      </header>

      {isIncomplete ? (
        <p
          className="mx-4 mb-3 rounded-md border border-outline-variant bg-surface-container-low px-3 py-2 text-sm text-on-surface-variant sm:mx-6"
          role="status"
        >
          Hay más documentos con saldo de los que se muestran: la lista y el total pueden
          estar incompletos.
        </p>
      ) : null}

      <div className="px-4 pb-4 md:px-0 md:pb-0">
        <DataTable
          cardSubtitle={(row) => formatDate(row.createdAt)}
          cardTitle={(row) => (
            <Link
              className="rounded font-mono text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              href={withReturnTo(documentHref(row), returnHref)}
            >
              {documentNumber(row)}
            </Link>
          )}
          columns={columns}
          data={documents}
          embedded
          emptyState={<EmptyState title="Sin saldos pendientes" />}
          error={openDocuments.error}
          getRowId={(row) => row.id}
          isFetching={openDocuments.isFetching}
          isLoading={openDocuments.isLoading}
          loadingRows={3}
          onRetry={() => void openDocuments.refetch()}
          variant="stitch-purchases"
        />
      </div>

      <RegisterPaymentModal
        onOpenChange={(open) => {
          if (!open) {
            setPayingDocumentId(undefined);
          }
        }}
        open={payingDocumentId !== undefined}
        purchaseId={type === "purchase" ? payingDocumentId : undefined}
        saleId={type === "sale" ? payingDocumentId : undefined}
      />
    </section>
  );
}

export type ContactBalancesTabProps = {
  /** Contacto dueño de los documentos. */
  contactId: string;
  /** Nombre del contacto, para el modal de abono. */
  contactName: string;
  /**
   * URL del detalle del contacto (ruta + query, relativa): viaja como `returnTo` a
   * los detalles de venta y compra para que "Volver" regrese aquí.
   */
  returnHref: string;
  /**
   * Secciones a pintar, ya filtradas por tipo de contacto y permisos con
   * `getContactBalanceSections`. Solo se pide al servidor lo que aparece aquí.
   */
  sections: readonly OpenDocumentType[];
};

/**
 * Pestaña "Saldos" del detalle de contacto: ventas por cobrar y/o compras por pagar
 * del contacto, con su total, "Abonar" (reparte un pago entre los documentos más
 * antiguos) y "Cobrar"/"Pagar" por documento.
 */
export function ContactBalancesTab({
  contactId,
  contactName,
  returnHref,
  sections,
}: ContactBalancesTabProps) {
  return (
    <div className="flex flex-col divide-y divide-outline-variant">
      {sections.map((type) => (
        <ContactBalancesSection
          contactId={contactId}
          contactName={contactName}
          key={type}
          returnHref={returnHref}
          type={type}
        />
      ))}
    </div>
  );
}
