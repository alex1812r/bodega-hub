import type { Permission, UserRole } from "@/shared/auth/permissions";

export type ContactType = "ambos" | "cliente" | "proveedor";
export type PaymentMethod =
  | "efectivo_usd"
  | "efectivo_ves"
  | "pago_movil"
  | "punto_venta"
  | "transferencia";
export type PaymentDirection = "entrada" | "salida";
export type PurchaseStatus = "cancelado" | "devuelto" | "pedido" | "recibido";
export type SaleStatus =
  | "borrador"
  | "cancelada"
  | "devuelta"
  | "pagada"
  | "pendiente_pago";
export type StockMovementType =
  | "ajuste_entrada"
  | "ajuste_salida"
  | "compra"
  | "devolucion_cliente"
  | "devolucion_proveedor"
  | "inventario_inicial"
  | "venta";

export type CategoryMock = {
  description?: string;
  id: string;
  name: string;
};

export type ContactMock = {
  address: string;
  email: string;
  id: string;
  isActive: boolean;
  name: string;
  phone: string;
  taxId: string;
  type: ContactType;
};

export type ProductMock = {
  categoryId: string;
  currentCostRef: number;
  currentStock: number;
  id: string;
  imageUrl?: string;
  isActive: boolean;
  minStock: number;
  name: string;
  salePriceRef: number;
  sku: string;
};

export type ProductPriceHistoryMock = {
  createdAt: string;
  id: string;
  productId: string;
  salePriceRef: number;
  userId: string;
};

export type ExchangeRateMock = {
  createdAt: string;
  id: string;
  rateVes: number;
  source: string;
};

export type SaleMock = {
  createdAt: string;
  customerId: string;
  discountRef: number;
  id: string;
  invoiceNumber: string;
  paidVes: number;
  refRateVes: number;
  status: SaleStatus;
  subtotalRef: number;
  taxRef: number;
  totalRef: number;
  totalVes: number;
  userId: string;
};

export type SaleItemMock = {
  productId: string;
  quantity: number;
  saleId: string;
  subtotalRef: number;
  subtotalVes: number;
  unitCostRefSnapshot: number;
  unitPriceRef: number;
};

export type PurchaseMock = {
  createdAt: string;
  discountRef: number;
  id: string;
  paidVes: number;
  purchaseNumber: string;
  refRateVes: number;
  status: PurchaseStatus;
  subtotalRef: number;
  supplierId: string;
  taxRef: number;
  totalRef: number;
  totalVes: number;
  userId: string;
};

export type PurchaseItemMock = {
  productId: string;
  purchaseId: string;
  quantity: number;
  subtotalRef: number;
  subtotalVes: number;
  unitCostRef: number;
  unitCostVes: number;
};

export type PaymentMock = {
  amount: number;
  amountRef: number;
  amountVes: number;
  bankName?: string;
  contactId: string;
  createdAt: string;
  currency?: "USD" | "VES";
  direction: PaymentDirection;
  id: string;
  method: PaymentMethod;
  notes?: string;
  pendingBalanceVes?: number;
  phone?: string;
  purchaseId?: string;
  referenceCode?: string;
  refRateVes: number;
  saleId?: string;
};

export type StockMovementMock = {
  createdAt: string;
  id: string;
  productId: string;
  purchaseId?: string;
  quantityDelta: number;
  reason?: string;
  saleId?: string;
  stockAfter: number;
  type: StockMovementType;
};

export type SupplierProductMock = {
  id: string;
  lastCostRef: number;
  productId: string;
  supplierId: string;
  supplierSku?: string;
};

export type UserProfileMock = {
  deniedPermissions?: Permission[];
  email: string;
  grantedPermissions?: Permission[];
  id: string;
  isActive: boolean;
  name: string;
  role: UserRole;
};

export type AppSettingsMock = {
  businessName: string;
  defaultTaxRate: number;
  invoicePrefix: string;
  lowStockThreshold: number;
};

export const mockCategories: CategoryMock[] = [
  { description: "Herramientas manuales y electricas", id: "cat-tools", name: "Herramientas" },
  { description: "Material electrico", id: "cat-electric", name: "Electricidad" },
  { description: "Pinturas y acabados", id: "cat-paint", name: "Pintura" },
  { description: "Tuberias, conexiones y accesorios", id: "cat-plumbing", name: "Plomeria" },
];

export const mockProducts: ProductMock[] = [
  {
    categoryId: "cat-tools",
    currentCostRef: 8.5,
    currentStock: 18,
    id: "prod-drill",
    isActive: true,
    minStock: 5,
    name: "Taladro percutor",
    salePriceRef: 15,
    sku: "HER-TAL-001",
  },
  {
    categoryId: "cat-electric",
    currentCostRef: 2.1,
    currentStock: 4,
    id: "prod-cable",
    isActive: true,
    minStock: 10,
    name: "Cable THW 12",
    salePriceRef: 3.5,
    sku: "ELE-CAB-012",
  },
  {
    categoryId: "cat-paint",
    currentCostRef: 12,
    currentStock: 9,
    id: "prod-paint",
    isActive: true,
    minStock: 4,
    name: "Pintura blanca galon",
    salePriceRef: 20,
    sku: "PIN-BLA-001",
  },
  {
    categoryId: "cat-tools",
    currentCostRef: 3.25,
    currentStock: 0,
    id: "prod-hammer",
    imageUrl: "/mock/products/hammer.webp",
    isActive: true,
    minStock: 3,
    name: "Martillo de una",
    salePriceRef: 7,
    sku: "HER-MAR-002",
  },
  {
    categoryId: "cat-electric",
    currentCostRef: 1.2,
    currentStock: 30,
    id: "prod-switch",
    isActive: true,
    minStock: 8,
    name: "Interruptor sencillo",
    salePriceRef: 2.5,
    sku: "ELE-INT-001",
  },
  {
    categoryId: "cat-paint",
    currentCostRef: 9,
    currentStock: 0,
    id: "prod-latex",
    imageUrl: "/mock/products/latex.webp",
    isActive: false,
    minStock: 2,
    name: "Pintura latex azul",
    salePriceRef: 16,
    sku: "PIN-AZU-002",
  },
  {
    categoryId: "cat-plumbing",
    currentCostRef: 4.8,
    currentStock: 12,
    id: "prod-pipe",
    isActive: true,
    minStock: 6,
    name: "Tubo PVC 1/2",
    salePriceRef: 8,
    sku: "PLO-PVC-012",
  },
];

export const mockProductPriceHistory: ProductPriceHistoryMock[] = [
  {
    createdAt: "2026-05-17T10:00:00.000Z",
    id: "price-drill-001",
    productId: "prod-drill",
    salePriceRef: 14,
    userId: "user-admin",
  },
  {
    createdAt: "2026-05-18T10:00:00.000Z",
    id: "price-drill-002",
    productId: "prod-drill",
    salePriceRef: 15,
    userId: "user-admin",
  },
  {
    createdAt: "2026-05-18T11:00:00.000Z",
    id: "price-cable-001",
    productId: "prod-cable",
    salePriceRef: 3.5,
    userId: "user-admin",
  },
  {
    createdAt: "2026-05-16T09:30:00.000Z",
    id: "price-hammer-001",
    productId: "prod-hammer",
    salePriceRef: 6.5,
    userId: "user-warehouse",
  },
  {
    createdAt: "2026-05-17T09:30:00.000Z",
    id: "price-hammer-002",
    productId: "prod-hammer",
    salePriceRef: 7,
    userId: "user-admin",
  },
  {
    createdAt: "2026-05-16T13:10:00.000Z",
    id: "price-pipe-001",
    productId: "prod-pipe",
    salePriceRef: 8,
    userId: "user-warehouse",
  },
];

export const mockContacts: ContactMock[] = [
  {
    address: "Av. Principal, Caracas",
    email: "cliente@example.com",
    id: "cont-customer",
    isActive: true,
    name: "Ferreteria La Central",
    phone: "0412-0000001",
    taxId: "J-00000001-1",
    type: "cliente",
  },
  {
    address: "Zona Industrial, Valencia",
    email: "proveedor@example.com",
    id: "cont-supplier",
    isActive: true,
    name: "Suministros Industriales CA",
    phone: "0414-0000002",
    taxId: "J-00000002-2",
    type: "proveedor",
  },
  {
    address: "Centro, Maracay",
    email: "mixto@example.com",
    id: "cont-both",
    isActive: true,
    name: "Comercial Doble Via",
    phone: "0424-0000003",
    taxId: "J-00000003-3",
    type: "ambos",
  },
  {
    address: "Av. Bolivar, Barquisimeto",
    email: "constructora@example.com",
    id: "cont-customer-alt",
    isActive: true,
    name: "Constructora Horizonte",
    phone: "0412-0000004",
    taxId: "J-00000004-4",
    type: "cliente",
  },
  {
    address: "Mercado Mayorista, Maracaibo",
    email: "proveedor.tools@example.com",
    id: "cont-supplier-tools",
    isActive: true,
    name: "Herramientas del Lago",
    phone: "0414-0000005",
    taxId: "J-00000005-5",
    type: "proveedor",
  },
  {
    address: "Calle Comercio, Merida",
    email: "cliente.inactivo@example.com",
    id: "cont-inactive",
    isActive: false,
    name: "Cliente Inactivo",
    phone: "0424-0000006",
    taxId: "J-00000006-6",
    type: "cliente",
  },
];

export const mockExchangeRates: ExchangeRateMock[] = [
  {
    createdAt: "2026-05-18T12:00:00.000Z",
    id: "rate-today",
    rateVes: 510,
    source: "Manual",
  },
  {
    createdAt: "2026-05-17T12:00:00.000Z",
    id: "rate-yesterday",
    rateVes: 505,
    source: "Manual",
  },
  {
    createdAt: "2026-05-16T12:00:00.000Z",
    id: "rate-two-days-ago",
    rateVes: 502,
    source: "BCV",
  },
  {
    createdAt: "2026-05-15T12:00:00.000Z",
    id: "rate-three-days-ago",
    rateVes: 498,
    source: "BCV",
  },
  {
    createdAt: "2026-05-14T12:00:00.000Z",
    id: "rate-four-days-ago",
    rateVes: 496,
    source: "Manual",
  },
];

export const mockSales: SaleMock[] = [
  {
    createdAt: "2026-05-18T14:30:00.000Z",
    customerId: "cont-customer",
    discountRef: 0,
    id: "sale-001",
    invoiceNumber: "V-000001",
    paidVes: 7650,
    refRateVes: 510,
    status: "pagada",
    subtotalRef: 15,
    taxRef: 0,
    totalRef: 15,
    totalVes: 7650,
    userId: "user-admin",
  },
  {
    createdAt: "2026-05-18T15:10:00.000Z",
    customerId: "cont-both",
    discountRef: 1,
    id: "sale-002",
    invoiceNumber: "V-000002",
    paidVes: 3000,
    refRateVes: 510,
    status: "pendiente_pago",
    subtotalRef: 23.5,
    taxRef: 0,
    totalRef: 22.5,
    totalVes: 11475,
    userId: "user-seller",
  },
  {
    createdAt: "2026-05-17T10:20:00.000Z",
    customerId: "cont-customer-alt",
    discountRef: 0,
    id: "sale-003",
    invoiceNumber: "V-000003",
    paidVes: 0,
    refRateVes: 505,
    status: "borrador",
    subtotalRef: 40,
    taxRef: 0,
    totalRef: 40,
    totalVes: 20200,
    userId: "user-seller",
  },
  {
    createdAt: "2026-05-16T11:45:00.000Z",
    customerId: "cont-customer-alt",
    discountRef: 2,
    id: "sale-004",
    invoiceNumber: "V-000004",
    paidVes: 0,
    refRateVes: 502,
    status: "cancelada",
    subtotalRef: 40,
    taxRef: 0,
    totalRef: 38,
    totalVes: 19076,
    userId: "user-admin",
  },
  {
    createdAt: "2026-05-15T09:15:00.000Z",
    customerId: "cont-customer",
    discountRef: 0,
    id: "sale-005",
    invoiceNumber: "V-000005",
    paidVes: 3486,
    refRateVes: 498,
    status: "devuelta",
    subtotalRef: 7,
    taxRef: 0,
    totalRef: 7,
    totalVes: 3486,
    userId: "user-seller",
  },
  {
    createdAt: "2026-05-14T16:30:00.000Z",
    customerId: "cont-both",
    discountRef: 0,
    id: "sale-006",
    invoiceNumber: "V-000006",
    paidVes: 18600,
    refRateVes: 496,
    status: "pagada",
    subtotalRef: 37.5,
    taxRef: 0,
    totalRef: 37.5,
    totalVes: 18600,
    userId: "user-admin",
  },
];

export const mockSaleItems: SaleItemMock[] = [
  {
    productId: "prod-drill",
    quantity: 1,
    saleId: "sale-001",
    subtotalRef: 15,
    subtotalVes: 7650,
    unitCostRefSnapshot: 8.5,
    unitPriceRef: 15,
  },
  {
    productId: "prod-paint",
    quantity: 1,
    saleId: "sale-002",
    subtotalRef: 20,
    subtotalVes: 10200,
    unitCostRefSnapshot: 12,
    unitPriceRef: 20,
  },
  {
    productId: "prod-cable",
    quantity: 1,
    saleId: "sale-002",
    subtotalRef: 3.5,
    subtotalVes: 1785,
    unitCostRefSnapshot: 2.1,
    unitPriceRef: 3.5,
  },
  {
    productId: "prod-hammer",
    quantity: 2,
    saleId: "sale-003",
    subtotalRef: 14,
    subtotalVes: 7070,
    unitCostRefSnapshot: 3.25,
    unitPriceRef: 7,
  },
  {
    productId: "prod-pipe",
    quantity: 2,
    saleId: "sale-003",
    subtotalRef: 16,
    subtotalVes: 8080,
    unitCostRefSnapshot: 4.8,
    unitPriceRef: 8,
  },
  {
    productId: "prod-switch",
    quantity: 4,
    saleId: "sale-003",
    subtotalRef: 10,
    subtotalVes: 5050,
    unitCostRefSnapshot: 1.2,
    unitPriceRef: 2.5,
  },
  {
    productId: "prod-paint",
    quantity: 2,
    saleId: "sale-004",
    subtotalRef: 40,
    subtotalVes: 20080,
    unitCostRefSnapshot: 12,
    unitPriceRef: 20,
  },
  {
    productId: "prod-hammer",
    quantity: 1,
    saleId: "sale-005",
    subtotalRef: 7,
    subtotalVes: 3486,
    unitCostRefSnapshot: 3.25,
    unitPriceRef: 7,
  },
  {
    productId: "prod-pipe",
    quantity: 3,
    saleId: "sale-006",
    subtotalRef: 24,
    subtotalVes: 11904,
    unitCostRefSnapshot: 4.8,
    unitPriceRef: 8,
  },
  {
    productId: "prod-switch",
    quantity: 4,
    saleId: "sale-006",
    subtotalRef: 10,
    subtotalVes: 4960,
    unitCostRefSnapshot: 1.2,
    unitPriceRef: 2.5,
  },
  {
    productId: "prod-cable",
    quantity: 1,
    saleId: "sale-006",
    subtotalRef: 3.5,
    subtotalVes: 1736,
    unitCostRefSnapshot: 2.1,
    unitPriceRef: 3.5,
  },
];

export const mockPurchases: PurchaseMock[] = [
  {
    createdAt: "2026-05-17T16:00:00.000Z",
    discountRef: 0,
    id: "purchase-001",
    paidVes: 10200,
    purchaseNumber: "C-000001",
    refRateVes: 510,
    status: "recibido",
    subtotalRef: 20,
    supplierId: "cont-supplier",
    taxRef: 0,
    totalRef: 20,
    totalVes: 10200,
    userId: "user-warehouse",
  },
  {
    createdAt: "2026-05-18T09:00:00.000Z",
    discountRef: 0,
    id: "purchase-002",
    paidVes: 0,
    purchaseNumber: "C-000002",
    refRateVes: 510,
    status: "pedido",
    subtotalRef: 52.4,
    supplierId: "cont-both",
    taxRef: 0,
    totalRef: 52.4,
    totalVes: 26724,
    userId: "user-warehouse",
  },
  {
    createdAt: "2026-05-16T15:20:00.000Z",
    discountRef: 1,
    id: "purchase-003",
    paidVes: 0,
    purchaseNumber: "C-000003",
    refRateVes: 502,
    status: "cancelado",
    subtotalRef: 34.5,
    supplierId: "cont-supplier-tools",
    taxRef: 0,
    totalRef: 33.5,
    totalVes: 16817,
    userId: "user-warehouse",
  },
  {
    createdAt: "2026-05-15T17:40:00.000Z",
    discountRef: 0,
    id: "purchase-004",
    paidVes: 2500,
    purchaseNumber: "C-000004",
    refRateVes: 498,
    status: "devuelto",
    subtotalRef: 18,
    supplierId: "cont-supplier",
    taxRef: 0,
    totalRef: 18,
    totalVes: 8964,
    userId: "user-warehouse",
  },
];

export const mockPurchaseItems: PurchaseItemMock[] = [
  {
    productId: "prod-cable",
    purchaseId: "purchase-001",
    quantity: 10,
    subtotalRef: 20,
    subtotalVes: 10200,
    unitCostRef: 2,
    unitCostVes: 1020,
  },
  {
    productId: "prod-hammer",
    purchaseId: "purchase-002",
    quantity: 8,
    subtotalRef: 26,
    subtotalVes: 13260,
    unitCostRef: 3.25,
    unitCostVes: 1657.5,
  },
  {
    productId: "prod-pipe",
    purchaseId: "purchase-002",
    quantity: 5,
    subtotalRef: 24,
    subtotalVes: 12240,
    unitCostRef: 4.8,
    unitCostVes: 2448,
  },
  {
    productId: "prod-switch",
    purchaseId: "purchase-002",
    quantity: 2,
    subtotalRef: 2.4,
    subtotalVes: 1224,
    unitCostRef: 1.2,
    unitCostVes: 612,
  },
  {
    productId: "prod-drill",
    purchaseId: "purchase-003",
    quantity: 3,
    subtotalRef: 25.5,
    subtotalVes: 12801,
    unitCostRef: 8.5,
    unitCostVes: 4267,
  },
  {
    productId: "prod-latex",
    purchaseId: "purchase-003",
    quantity: 1,
    subtotalRef: 9,
    subtotalVes: 4518,
    unitCostRef: 9,
    unitCostVes: 4518,
  },
  {
    productId: "prod-pipe",
    purchaseId: "purchase-004",
    quantity: 4,
    subtotalRef: 18,
    subtotalVes: 8964,
    unitCostRef: 4.5,
    unitCostVes: 2241,
  },
];

export const mockPayments: PaymentMock[] = [
  {
    amount: 7650,
    amountRef: 15,
    amountVes: 7650,
    contactId: "cont-customer",
    createdAt: "2026-05-18T14:35:00.000Z",
    direction: "entrada",
    id: "pay-001",
    method: "punto_venta",
    referenceCode: "778899",
    refRateVes: 510,
    saleId: "sale-001",
  },
  {
    amount: 3000,
    amountRef: 5.88,
    amountVes: 3000,
    bankName: "Banco Nacional",
    contactId: "cont-both",
    createdAt: "2026-05-18T15:12:00.000Z",
    direction: "entrada",
    id: "pay-002",
    method: "pago_movil",
    referenceCode: "1234",
    refRateVes: 510,
    saleId: "sale-002",
  },
  {
    amount: 10200,
    amountRef: 20,
    amountVes: 10200,
    contactId: "cont-supplier",
    createdAt: "2026-05-17T16:20:00.000Z",
    direction: "salida",
    id: "pay-003",
    method: "transferencia",
    purchaseId: "purchase-001",
    referenceCode: "TRX-001",
    refRateVes: 510,
  },
  {
    amount: 2000,
    amountRef: 3.92,
    amountVes: 2000,
    contactId: "cont-both",
    createdAt: "2026-05-18T15:25:00.000Z",
    currency: "VES",
    direction: "entrada",
    id: "pay-004",
    method: "efectivo_ves",
    pendingBalanceVes: 6475,
    refRateVes: 510,
    saleId: "sale-002",
  },
  {
    amount: 7,
    amountRef: 7,
    amountVes: 3486,
    contactId: "cont-customer",
    createdAt: "2026-05-15T09:20:00.000Z",
    currency: "USD",
    direction: "entrada",
    id: "pay-005",
    method: "efectivo_usd",
    pendingBalanceVes: 0,
    refRateVes: 498,
    saleId: "sale-005",
  },
  {
    amount: 2500,
    amountRef: 5.02,
    amountVes: 2500,
    contactId: "cont-supplier",
    createdAt: "2026-05-15T17:50:00.000Z",
    currency: "VES",
    direction: "salida",
    id: "pay-006",
    method: "efectivo_ves",
    pendingBalanceVes: 6464,
    purchaseId: "purchase-004",
    refRateVes: 498,
  },
  {
    amount: 18600,
    amountRef: 37.5,
    amountVes: 18600,
    bankName: "Banco Nacional",
    contactId: "cont-both",
    createdAt: "2026-05-14T16:35:00.000Z",
    direction: "entrada",
    id: "pay-007",
    method: "transferencia",
    pendingBalanceVes: 0,
    referenceCode: "TRX-777",
    refRateVes: 496,
    saleId: "sale-006",
  },
];

export const mockStockMovements: StockMovementMock[] = [
  {
    createdAt: "2026-05-17T16:00:00.000Z",
    id: "mov-001",
    productId: "prod-cable",
    purchaseId: "purchase-001",
    quantityDelta: 10,
    stockAfter: 5,
    type: "compra",
  },
  {
    createdAt: "2026-05-18T14:30:00.000Z",
    id: "mov-002",
    productId: "prod-drill",
    quantityDelta: -1,
    saleId: "sale-001",
    stockAfter: 18,
    type: "venta",
  },
  {
    createdAt: "2026-05-18T15:10:00.000Z",
    id: "mov-003",
    productId: "prod-cable",
    quantityDelta: -1,
    saleId: "sale-002",
    stockAfter: 4,
    type: "venta",
  },
  {
    createdAt: "2026-05-16T08:00:00.000Z",
    id: "mov-004",
    productId: "prod-hammer",
    quantityDelta: 6,
    reason: "Carga inicial de producto",
    stockAfter: 6,
    type: "inventario_inicial",
  },
  {
    createdAt: "2026-05-16T09:00:00.000Z",
    id: "mov-005",
    productId: "prod-hammer",
    quantityDelta: -6,
    reason: "Conteo fisico",
    stockAfter: 0,
    type: "ajuste_salida",
  },
  {
    createdAt: "2026-05-17T10:20:00.000Z",
    id: "mov-006",
    productId: "prod-hammer",
    quantityDelta: -2,
    saleId: "sale-003",
    stockAfter: 4,
    type: "venta",
  },
  {
    createdAt: "2026-05-17T10:20:00.000Z",
    id: "mov-007",
    productId: "prod-pipe",
    quantityDelta: -2,
    saleId: "sale-003",
    stockAfter: 10,
    type: "venta",
  },
  {
    createdAt: "2026-05-18T09:00:00.000Z",
    id: "mov-008",
    productId: "prod-pipe",
    purchaseId: "purchase-002",
    quantityDelta: 5,
    stockAfter: 15,
    type: "compra",
  },
  {
    createdAt: "2026-05-15T09:25:00.000Z",
    id: "mov-009",
    productId: "prod-hammer",
    quantityDelta: 1,
    reason: "Devolucion de venta V-000005",
    saleId: "sale-005",
    stockAfter: 1,
    type: "devolucion_cliente",
  },
  {
    createdAt: "2026-05-15T18:00:00.000Z",
    id: "mov-010",
    productId: "prod-pipe",
    purchaseId: "purchase-004",
    quantityDelta: -4,
    reason: "Devolucion de compra C-000004",
    stockAfter: 11,
    type: "devolucion_proveedor",
  },
  {
    createdAt: "2026-05-14T10:00:00.000Z",
    id: "mov-011",
    productId: "prod-switch",
    quantityDelta: 5,
    reason: "Ajuste por inventario",
    stockAfter: 30,
    type: "ajuste_entrada",
  },
];

export const mockSupplierProducts: SupplierProductMock[] = [
  {
    id: "supp-prod-cable",
    lastCostRef: 2,
    productId: "prod-cable",
    supplierId: "cont-supplier",
    supplierSku: "SUP-CAB-12",
  },
  {
    id: "supp-prod-drill",
    lastCostRef: 8.5,
    productId: "prod-drill",
    supplierId: "cont-both",
    supplierSku: "DOB-TAL-01",
  },
  {
    id: "supp-prod-hammer",
    lastCostRef: 3.25,
    productId: "prod-hammer",
    supplierId: "cont-supplier-tools",
    supplierSku: "HDL-MAR-16",
  },
  {
    id: "supp-prod-pipe",
    lastCostRef: 4.8,
    productId: "prod-pipe",
    supplierId: "cont-both",
    supplierSku: "DOB-PVC-012",
  },
  {
    id: "supp-prod-switch",
    lastCostRef: 1.2,
    productId: "prod-switch",
    supplierId: "cont-supplier",
    supplierSku: "SUP-INT-001",
  },
];

export const mockUserProfiles: UserProfileMock[] = [
  {
    email: "admin@example.com",
    id: "user-admin",
    isActive: true,
    name: "Admin Demo",
    role: "admin",
  },
  {
    email: "vendedor@example.com",
    id: "user-seller",
    isActive: true,
    name: "Vendedor Demo",
    role: "vendedor",
  },
  {
    email: "vendedor.contactos@example.com",
    grantedPermissions: ["contacts.manage"],
    id: "55555555-5555-4555-8555-555555555555",
    isActive: true,
    name: "Vendedor Contactos Demo",
    role: "vendedor",
  },
  {
    email: "almacen@example.com",
    id: "user-warehouse",
    isActive: true,
    name: "Almacen Demo",
    role: "almacen",
  },
  {
    email: "contador@example.com",
    id: "user-accountant",
    isActive: true,
    name: "Contador Demo",
    role: "contador",
  },
  {
    deniedPermissions: ["products.manage"],
    email: "almacen.limitado@example.com",
    id: "user-warehouse-limited",
    isActive: true,
    name: "Almacen Limitado",
    role: "almacen",
  },
  {
    deniedPermissions: ["payments.view"],
    email: "vendedor.caja@example.com",
    grantedPermissions: ["payments.manage"],
    id: "user-seller-cashier",
    isActive: true,
    name: "Vendedor Cajero",
    role: "vendedor",
  },
  {
    email: "usuario.inactivo@example.com",
    id: "user-inactive",
    isActive: false,
    name: "Usuario Inactivo",
    role: "vendedor",
  },
];

export const mockAppSettings: AppSettingsMock = {
  businessName: "Control Ventas ERP",
  defaultTaxRate: 0,
  invoicePrefix: "V",
  lowStockThreshold: 5,
};
