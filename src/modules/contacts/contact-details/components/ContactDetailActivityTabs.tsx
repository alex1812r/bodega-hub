"use client";

import { CreditCard, Receipt, ShoppingCart } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

import { getPaginatedItems } from "@/lib/api/pagination";
import { paymentMethodLabels } from "@/modules/payments/payment-details/utils/paymentDetailLabels";
import { getPaymentDocument } from "@/modules/payments/payments-list/utils/paymentDocument";
import { canViewSupplierContacts } from "@/shared/auth/contactAccess";
import type { Permission } from "@/shared/auth/permissions";
import { usePermission } from "@/shared/auth/usePermission";
import type { DataTableColumn } from "@/shared/components/DataTable";
import { type TabItem, Tabs } from "@/shared/components/Tabs";
import type { ContactType, PaymentMock, PurchaseMock, SaleMock } from "@/shared/mocks/erp-data";
import { formatRefUsd, formatVesBs } from "@/shared/utils/currency";
import { formatDate } from "@/shared/utils/date";
import { withChainedReturnTo } from "@/shared/utils/returnTo";

import type { ContactActivityApiRow } from "../../hooks/useContacts";
import { CONTACT_DETAIL_TAB_PARAM, type ContactDetailTab } from "../hooks/contactDetailParams";
import { useContactDetailUrl } from "../hooks/useContactDetailUrl";
import {
  useContactActivityList,
  useContactPaymentsList,
  useContactPurchasesList,
  useContactSalesList,
} from "../hooks/useContactSubLists";
import { ContactActivityTimeline, buildActivityTimelineItems } from "./ContactActivityTimeline";
import { ContactBalancesTab, getContactBalanceSections } from "./ContactBalancesTab";
import {
  ContactSubListPagination,
  ContactSubListPanel,
  ContactTabForbidden,
  isForbiddenError,
} from "./ContactSubListPanel";
import { ContactSupplierProductsTab } from "./ContactSupplierProductsTab";

const linkClassName = "font-medium text-primary hover:underline dark:text-indigo-300";

/** Tipo de actividad → etiqueta, ruta del detalle y permiso que exige ese detalle. */
const activityTargets: Record<
  ContactActivityApiRow["type"],
  { basePath: string; label: "venta" | "compra" | "pago"; permission: Permission }
> = {
  payment: { basePath: "/payments", label: "pago", permission: "payments.view" },
  purchase: { basePath: "/purchases", label: "compra", permission: "purchases.view" },
  sale: { basePath: "/sales", label: "venta", permission: "sales.view" },
};

type ContactTabProps = {
  contactId: string;
};

function ContactActivityTab({ contactId }: ContactTabProps) {
  const { can } = usePermission();
  const list = useContactActivityList(contactId);
  const rows = list.data;
  const detailUrl = list.href;
  const items = useMemo(
    () =>
      buildActivityTimelineItems(
        getPaginatedItems(rows).map((row) => {
          const target = activityTargets[row.type];

          return {
            amountVes: row.amountVes,
            createdAt: row.createdAt,
            href: can(target.permission)
              ? withChainedReturnTo(`${target.basePath}/${encodeURIComponent(row.id)}`, detailUrl)
              : undefined,
            id: `${row.type}-${row.id}`,
            type: target.label,
          };
        }),
        (isoDate) => formatDate(isoDate),
      ),
    [can, detailUrl, rows],
  );

  if (isForbiddenError(list.error)) {
    return <ContactTabForbidden what="la actividad" />;
  }

  return (
    <>
      <div className="p-4 sm:p-6">
        <ContactActivityTimeline
          error={list.error}
          isFetching={list.isFetching}
          isLoading={list.isLoading}
          items={items}
          onRetry={() => void list.refetch()}
        />
      </div>
      <ContactSubListPagination entityLabel="movimientos" list={list} />
    </>
  );
}

function ContactSalesTab({ contactId }: ContactTabProps) {
  const { can } = usePermission();
  const list = useContactSalesList(contactId);
  const canOpen = can("sales.view");
  const columns: DataTableColumn<SaleMock>[] = [
    {
      header: "Factura",
      key: "invoiceNumber",
      render: (row) =>
        canOpen ? (
          <Link
            className={linkClassName}
            href={withChainedReturnTo(`/sales/${encodeURIComponent(row.id)}`, list.href)}
          >
            {row.invoiceNumber}
          </Link>
        ) : (
          row.invoiceNumber
        ),
    },
    { header: "Fecha", key: "createdAt", render: (row) => formatDate(row.createdAt) },
    {
      align: "right",
      header: "Total REF",
      key: "totalRef",
      render: (row) => formatRefUsd(row.totalRef),
    },
  ];

  return (
    <ContactSubListPanel
      columns={columns}
      emptyDescription="Las ventas a este contacto aparecerán aquí."
      emptyTitle="Sin ventas registradas"
      entityLabel="ventas"
      forbiddenWhat="las ventas"
      getRowId={(row) => row.id}
      icon={<Receipt aria-hidden className="h-5 w-5" />}
      list={list}
    />
  );
}

function ContactPurchasesTab({ contactId }: ContactTabProps) {
  const list = useContactPurchasesList(contactId);
  const columns: DataTableColumn<PurchaseMock>[] = [
    {
      header: "Compra",
      key: "purchaseNumber",
      render: (row) => (
        <Link
          className={linkClassName}
          href={withChainedReturnTo(`/purchases/${encodeURIComponent(row.id)}`, list.href)}
        >
          {row.purchaseNumber}
        </Link>
      ),
    },
    { header: "Fecha", key: "createdAt", render: (row) => formatDate(row.createdAt) },
    {
      align: "right",
      header: "Total REF",
      key: "totalRef",
      render: (row) => formatRefUsd(row.totalRef),
    },
  ];

  return (
    <ContactSubListPanel
      columns={columns}
      emptyDescription="Las compras a este contacto aparecerán aquí."
      emptyTitle="Sin compras registradas"
      entityLabel="compras"
      forbiddenWhat="las compras"
      getRowId={(row) => row.id}
      icon={<ShoppingCart aria-hidden className="h-5 w-5" />}
      list={list}
    />
  );
}

function ContactPaymentsTab({ contactId }: ContactTabProps) {
  const { can } = usePermission();
  const list = useContactPaymentsList(contactId);
  const canOpen = can("payments.view");
  const canOpenSales = can("sales.view");
  const canOpenPurchases = can("purchases.view");
  const columns: DataTableColumn<PaymentMock>[] = [
    {
      header: "Fecha",
      key: "createdAt",
      render: (row) => {
        const date = formatDate(row.createdAt);

        return canOpen ? (
          <Link
            aria-label={`Ver pago del ${date}`}
            className={linkClassName}
            href={withChainedReturnTo(`/payments/${encodeURIComponent(row.id)}`, list.href)}
          >
            {date}
          </Link>
        ) : (
          date
        );
      },
    },
    {
      header: "Documento",
      key: "document",
      render: (row) => {
        // La venta o compra que abona el pago. Esta lista no trae su número: se nombra por su tipo.
        const document = getPaymentDocument(row);

        if (!document) {
          return <span className="text-on-surface-variant">—</span>;
        }

        const canOpenDocument = document.kind === "sale" ? canOpenSales : canOpenPurchases;

        return canOpenDocument ? (
          <Link
            aria-label={`Ver la ${document.label.toLowerCase()} del pago del ${formatDate(row.createdAt)}`}
            className={linkClassName}
            href={withChainedReturnTo(document.href, list.href)}
          >
            {document.label}
          </Link>
        ) : (
          document.label
        );
      },
    },
    {
      header: "Método",
      key: "method",
      render: (row) => paymentMethodLabels[row.method] ?? row.method,
    },
    {
      align: "right",
      header: "Monto VES",
      key: "amountVes",
      render: (row) => formatVesBs(row.amountVes),
    },
  ];

  return (
    <ContactSubListPanel
      columns={columns}
      emptyDescription="Los pagos y cobros de este contacto aparecerán aquí."
      emptyTitle="Sin pagos registrados"
      entityLabel="pagos"
      forbiddenWhat="los pagos"
      getRowId={(row) => row.id}
      icon={<CreditCard aria-hidden className="h-5 w-5" />}
      list={list}
    />
  );
}

type ContactBalancesPanelProps = {
  contactId: string;
  contactName: string;
  sections: ReturnType<typeof getContactBalanceSections>;
};

/** Monta la pestaña "Saldos" de Pagos con la URL del detalle como destino de retorno. */
function ContactBalancesPanel({ contactId, contactName, sections }: ContactBalancesPanelProps) {
  const detailUrl = useContactDetailUrl();

  return (
    <ContactBalancesTab
      contactId={contactId}
      contactName={contactName}
      returnHref={detailUrl}
      sections={sections}
    />
  );
}

type ContactDetailActivityTabsProps = {
  contactId: string;
  contactName?: string;
  contactType: ContactType;
};

function isSupplierContact(type: ContactType) {
  return type === "proveedor" || type === "ambos";
}

export function ContactDetailActivityTabs({
  contactId,
  contactName,
  contactType,
}: ContactDetailActivityTabsProps) {
  const { can, role } = usePermission();
  const canSeeSuppliers = role ? canViewSupplierContacts(role) : false;
  const showProductsTab =
    isSupplierContact(contactType) && can("products.view") && canSeeSuppliers;
  const showPurchasesTab = can("purchases.view") && canSeeSuppliers;
  // Sin permiso para ninguna sección no hay pestaña: nunca una que acabe en 403.
  const balanceSections = getContactBalanceSections(contactType, { can, role });

  const tabs: TabItem<ContactDetailTab>[] = [
    {
      content: <ContactActivityTab contactId={contactId} />,
      label: "Actividad reciente",
      value: "actividad",
    },
    { content: <ContactSalesTab contactId={contactId} />, label: "Ventas", value: "ventas" },
    ...(showPurchasesTab
      ? [
          {
            content: <ContactPurchasesTab contactId={contactId} />,
            label: "Compras",
            value: "compras" as const,
          },
        ]
      : []),
    { content: <ContactPaymentsTab contactId={contactId} />, label: "Pagos", value: "pagos" },
    ...(balanceSections.length > 0
      ? [
          {
            content: (
              <ContactBalancesPanel
                contactId={contactId}
                contactName={contactName ?? ""}
                sections={balanceSections}
              />
            ),
            label: "Saldos",
            value: "saldos" as const,
          },
        ]
      : []),
    ...(showProductsTab
      ? [
          {
            content: (
              <ContactSupplierProductsTab supplierId={contactId} supplierName={contactName} />
            ),
            label: "Productos",
            value: "productos" as const,
          },
        ]
      : []),
  ];

  return (
    <section className="overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm">
      <Tabs
        ariaLabel="Actividad del contacto"
        defaultValue="actividad"
        items={tabs}
        panelClassName="pt-0"
        urlParam={CONTACT_DETAIL_TAB_PARAM}
      />
    </section>
  );
}
