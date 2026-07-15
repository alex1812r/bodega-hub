"use client";

import { useId, useState } from "react";

import { usePermission } from "@/shared/auth/usePermission";
import type { ContactType } from "@/shared/mocks/erp-data";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import type { PaymentMock, PurchaseMock, SaleMock } from "@/shared/mocks/erp-data";
import { formatRefUsd, formatVesBs } from "@/shared/utils/currency";
import { formatDate } from "@/shared/utils/date";
import { cn } from "@/shared/utils/cn";

import {
  ContactActivityTimeline,
  type ContactActivityTimelineItem,
} from "./ContactActivityTimeline";
import { ContactSupplierProductsTab } from "./ContactSupplierProductsTab";

const salesColumns: DataTableColumn<SaleMock>[] = [
  { header: "Factura", key: "invoiceNumber", render: (row) => row.invoiceNumber },
  { header: "Fecha", key: "createdAt", render: (row) => formatDate(row.createdAt) },
  {
    align: "right",
    header: "Total REF",
    key: "totalRef",
    render: (row) => formatRefUsd(row.totalRef),
  },
];

const purchasesColumns: DataTableColumn<PurchaseMock>[] = [
  { header: "Compra", key: "purchaseNumber", render: (row) => row.purchaseNumber },
  { header: "Fecha", key: "createdAt", render: (row) => formatDate(row.createdAt) },
  {
    align: "right",
    header: "Total REF",
    key: "totalRef",
    render: (row) => formatRefUsd(row.totalRef),
  },
];

const paymentsColumns: DataTableColumn<PaymentMock>[] = [
  { header: "Fecha", key: "createdAt", render: (row) => formatDate(row.createdAt) },
  { header: "Método", key: "method", render: (row) => row.method },
  {
    align: "right",
    header: "Monto VES",
    key: "amountVes",
    render: (row) => formatVesBs(row.amountVes),
  },
];

const baseTabs = [
  { id: "activity", label: "Actividad reciente" },
  { id: "sales", label: "Ventas" },
  { id: "purchases", label: "Compras" },
  { id: "payments", label: "Pagos" },
] as const;

type BaseTabId = (typeof baseTabs)[number]["id"];
type ContactDetailTabId = BaseTabId | "products";

type QuerySlice<T> = {
  data: T[];
  error?: Error | string | null;
  isFetching?: boolean;
  isLoading?: boolean;
  onRetry?: () => void;
};

type ActivityTabState = {
  error?: Error | string | null;
  isFetching?: boolean;
  isLoading?: boolean;
  items: ContactActivityTimelineItem[];
  onRetry?: () => void;
};

type ContactDetailActivityTabsProps = {
  activity: ActivityTabState;
  contactId: string;
  contactName?: string;
  contactType: ContactType;
  payments: QuerySlice<PaymentMock>;
  purchases: QuerySlice<PurchaseMock>;
  sales: QuerySlice<SaleMock>;
};

function isSupplierContact(type: ContactType) {
  return type === "proveedor" || type === "ambos";
}

export function ContactDetailActivityTabs({
  activity,
  contactId,
  contactName,
  contactType,
  payments,
  purchases,
  sales,
}: ContactDetailActivityTabsProps) {
  const baseId = useId();
  const { can } = usePermission();
  const [activeTab, setActiveTab] = useState<ContactDetailTabId>("activity");
  const showProductsTab = isSupplierContact(contactType) && can("products.view");
  const tabs = showProductsTab
    ? [...baseTabs, { id: "products" as const, label: "Productos" }]
    : baseTabs;

  return (
    <section className="flex flex-col overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm">
      <div
        className="flex overflow-x-auto border-b border-outline-variant px-2"
        role="tablist"
        aria-label="Actividad del contacto"
      >
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          const tabId = `${baseId}-${tab.id}`;

          return (
            <button
              aria-controls={`${tabId}-panel`}
              aria-selected={isActive}
              className={cn(
                "shrink-0 cursor-pointer whitespace-nowrap px-4 py-3 text-sm font-medium transition-colors",
                isActive
                  ? "border-b-2 border-primary font-semibold text-primary"
                  : "text-on-surface-variant hover:bg-surface-container-low",
              )}
              id={tabId}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              role="tab"
              type="button"
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "activity" ? (
        <div
          aria-labelledby={`${baseId}-activity`}
          className="p-6"
          id={`${baseId}-activity-panel`}
          role="tabpanel"
        >
          <ContactActivityTimeline
            error={activity.error}
            isFetching={activity.isFetching}
            isLoading={activity.isLoading}
            items={activity.items}
            onRetry={activity.onRetry}
          />
        </div>
      ) : null}

      {activeTab === "sales" ? (
        <div aria-labelledby={`${baseId}-sales`} id={`${baseId}-sales-panel`} role="tabpanel">
          <DataTable
            columns={salesColumns}
            data={sales.data}
            embedded
            error={sales.error}
            getRowId={(row) => row.id}
            isFetching={sales.isFetching}
            isLoading={sales.isLoading}
            loadingRows={3}
            onRetry={sales.onRetry}
            variant="stitch-purchases"
          />
        </div>
      ) : null}

      {activeTab === "purchases" ? (
        <div aria-labelledby={`${baseId}-purchases`} id={`${baseId}-purchases-panel`} role="tabpanel">
          <DataTable
            columns={purchasesColumns}
            data={purchases.data}
            embedded
            error={purchases.error}
            getRowId={(row) => row.id}
            isFetching={purchases.isFetching}
            isLoading={purchases.isLoading}
            loadingRows={3}
            onRetry={purchases.onRetry}
            variant="stitch-purchases"
          />
        </div>
      ) : null}

      {activeTab === "payments" ? (
        <div aria-labelledby={`${baseId}-payments`} id={`${baseId}-payments-panel`} role="tabpanel">
          <DataTable
            columns={paymentsColumns}
            data={payments.data}
            embedded
            error={payments.error}
            getRowId={(row) => row.id}
            isFetching={payments.isFetching}
            isLoading={payments.isLoading}
            loadingRows={3}
            onRetry={payments.onRetry}
            variant="stitch-purchases"
          />
        </div>
      ) : null}

      {activeTab === "products" && showProductsTab ? (
        <div aria-labelledby={`${baseId}-products`} id={`${baseId}-products-panel`} role="tabpanel">
          <ContactSupplierProductsTab supplierId={contactId} supplierName={contactName} />
        </div>
      ) : null}
    </section>
  );
}
