import type { ContactType, PaymentMock, PurchaseMock, SaleMock } from "@/shared/mocks/erp-data";

export type ContactDetailMetrics = {
  operationsLabel: string;
  operationsTotalRef: number;
  payableRef: number;
  paymentsTotalRef: number;
  receivableRef: number;
};

function sumRef<T>(rows: T[], pick: (row: T) => number) {
  return rows.reduce((total, row) => total + pick(row), 0);
}

export function computeContactDetailMetrics(
  contactType: ContactType,
  sales: SaleMock[],
  purchases: PurchaseMock[],
  payments: PaymentMock[],
): ContactDetailMetrics {
  const salesTotalRef = sumRef(sales, (row) => row.totalRef);
  const purchasesTotalRef = sumRef(purchases, (row) => row.totalRef);
  const paymentsTotalRef = sumRef(payments, (row) => row.amountRef);

  const salesPaymentsRef = sumRef(
    payments.filter((payment) => payment.direction === "entrada"),
    (row) => row.amountRef,
  );
  const purchasePaymentsRef = sumRef(
    payments.filter((payment) => payment.direction === "salida"),
    (row) => row.amountRef,
  );

  const operationsLabel =
    contactType === "cliente"
      ? "Total Ventas (REF)"
      : contactType === "proveedor"
        ? "Total Compras (REF)"
        : "Total Operaciones (REF)";

  const operationsTotalRef =
    contactType === "cliente"
      ? salesTotalRef
      : contactType === "proveedor"
        ? purchasesTotalRef
        : salesTotalRef + purchasesTotalRef;

  const receivableRef = Math.max(0, salesTotalRef - salesPaymentsRef);
  const payableRef = Math.max(0, purchasesTotalRef - purchasePaymentsRef);

  return {
    operationsLabel,
    operationsTotalRef,
    payableRef,
    paymentsTotalRef,
    receivableRef,
  };
}

export function showsReceivableMetric(contactType: ContactType) {
  return contactType === "cliente" || contactType === "ambos";
}

export function showsPayableMetric(contactType: ContactType) {
  return contactType === "proveedor" || contactType === "ambos";
}
