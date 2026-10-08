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

/** Venta en la que `register_payment` acepta un cobro. */
function isOpenSale(sale: SaleMock) {
  return sale.status === "pendiente_pago" || sale.status === "pagada";
}

/** Compra en la que `register_payment` acepta un pago: ni cancelada ni devuelta. */
function isOpenPurchase(purchase: PurchaseMock) {
  return purchase.status === "pedido" || purchase.status === "recibido";
}

/**
 * Saldos ya calculados por el servidor sobre TODOS los documentos con saldo del
 * contacto (los totales de la pestaña "Saldos"). Sin valor para una métrica, esa
 * métrica se calcula con las filas recibidas.
 */
export type ContactOpenBalances = {
  payableRef?: number;
  receivableRef?: number;
};

/**
 * Saldo en REF de una lista de documentos con saldo (`totals` de `useOpenDocuments`):
 * `0` si no hay ninguno y `undefined` si la lista no ha llegado o no trae REF.
 */
export function openBalanceRef(totals: { count: number; pendingRef?: number } | undefined) {
  if (!totals) {
    return undefined;
  }

  return totals.pendingRef ?? (totals.count === 0 ? 0 : undefined);
}

/**
 * `sales`, `purchases` y `payments` son la primera página del contacto: con más filas
 * que esa página, el saldo calculado aquí queda mal. Por eso `openBalances`, cuando
 * viene, manda sobre `receivableRef` / `payableRef`.
 */
export function computeContactDetailMetrics(
  contactType: ContactType,
  sales: SaleMock[],
  purchases: PurchaseMock[],
  payments: PaymentMock[],
  openBalances: ContactOpenBalances = {},
): ContactDetailMetrics {
  const salesTotalRef = sumRef(sales, (row) => row.totalRef);
  const purchasesTotalRef = sumRef(purchases, (row) => row.totalRef);
  // Un pago anulado ya no cuenta: ni como pago realizado ni contra ningún saldo.
  const activePayments = payments.filter((payment) => payment.status !== "anulado");
  const paymentsTotalRef = sumRef(activePayments, (row) => row.amountRef);

  // El saldo sale solo de documentos que admiten pago, como la pestaña "Saldos"
  // (`OPEN_SALE_STATUSES` / `OPEN_PURCHASE_STATUSES` de open-documents). Los pagos
  // de un documento cargado que no lo admite tampoco bajan el saldo de los demás.
  const closedSaleIds = new Set(
    sales.filter((sale) => !isOpenSale(sale)).map((sale) => sale.id),
  );
  const closedPurchaseIds = new Set(
    purchases.filter((purchase) => !isOpenPurchase(purchase)).map((purchase) => purchase.id),
  );
  const openSalesTotalRef = sumRef(sales.filter(isOpenSale), (row) => row.totalRef);
  const openPurchasesTotalRef = sumRef(purchases.filter(isOpenPurchase), (row) => row.totalRef);

  const salesPaymentsRef = sumRef(
    activePayments.filter(
      (payment) =>
        payment.direction === "entrada" &&
        !(payment.saleId !== undefined && closedSaleIds.has(payment.saleId)),
    ),
    (row) => row.amountRef,
  );
  const purchasePaymentsRef = sumRef(
    activePayments.filter(
      (payment) =>
        payment.direction === "salida" &&
        !(payment.purchaseId !== undefined && closedPurchaseIds.has(payment.purchaseId)),
    ),
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

  const receivableRef =
    openBalances.receivableRef ?? Math.max(0, openSalesTotalRef - salesPaymentsRef);
  const payableRef =
    openBalances.payableRef ?? Math.max(0, openPurchasesTotalRef - purchasePaymentsRef);

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
