import { http, HttpResponse } from "msw";

import { ApiError } from "../src/lib/api/apiError";
import {
  createContact,
  getContactActivity,
  getContactById,
  getContactPayments,
  getContactPurchases,
  getContactSales,
  listContacts,
  updateContact,
} from "../src/modules/contacts/services/contacts.mock-server";
import {
  getDashboardLowStock,
  getDashboardMetrics,
  getDashboardSummary,
  getRecentSales,
} from "../src/modules/dashboard/services/dashboard.mock-server";
import {
  createStockAdjustment,
  getStockCard,
  listInventory,
  listStockMovements,
} from "../src/modules/inventory/services/inventory.mock-server";
import {
  createPayment,
  getPaymentById,
  listPayments,
} from "../src/modules/payments/services/payments.mock-server";
import {
  createCategory,
  listCategories,
} from "../src/modules/products/services/categories.mock-server";
import {
  createProduct,
  getProductById,
  getProductPriceHistory,
  listProducts,
  updateProduct,
  updateProductPrice,
} from "../src/modules/products/services/products.mock-server";
import {
  cancelPurchase,
  createPurchase,
  getPurchaseById,
  listPurchases,
  returnPurchase,
} from "../src/modules/purchases/services/purchases.mock-server";
import {
  getCustomerPurchasesReport,
  getDailySalesReport,
  getGrossProfitReport,
  getLowStockReport,
  getProductProfitabilityReport,
  getPurchasesReport,
  getStockCard as getStockCardReport,
  getSupplierPurchasesReport,
  getTopCustomersReport,
  getTopProductsReport,
} from "../src/modules/reports/services/reports.mock-server";
import {
  cancelSale,
  createSale,
  getSaleById,
  getSaleReceipt,
  listSales,
  returnSale,
} from "../src/modules/sales/services/sales.mock-server";
import {
  createExchangeRate,
  getCurrentExchangeRate,
  listExchangeRates,
} from "../src/modules/settings/services/exchangeRates.mock-server";
import {
  getSettings,
  listUsers,
  updateSettings,
  updateUser,
} from "../src/modules/settings/services/settings.mock-server";
import {
  createSupplierProduct,
  getSupplierProductById,
  listProductSuppliers,
  listSupplierProducts,
  listSupplierProductsBySupplier,
  updateSupplierProduct,
} from "../src/modules/contacts/services/supplierProducts.mock-server";
import {
  getEffectivePermissions,
  isUserRole,
  permissions,
  userRoles,
  type UserRole,
} from "../src/shared/auth/permissions";
import { mockUserProfiles } from "../src/shared/mocks/erp-data";

function searchParams(request: Request) {
  return new URL(request.url).searchParams;
}

function jsonData<TData>(data: TData, status = 200) {
  return HttpResponse.json({ data }, { status });
}

function jsonError(error: unknown) {
  if (error instanceof ApiError) {
    return HttpResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
        },
      },
      { status: error.status },
    );
  }

  return HttpResponse.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Ocurrio un error inesperado.",
      },
    },
    { status: 500 },
  );
}

function fromService<TData>(callback: () => TData, status = 200) {
  try {
    return jsonData(callback(), status);
  } catch (error) {
    return jsonError(error);
  }
}

async function fromJson<TData>(
  request: Request,
  callback: (input: never) => TData,
  status = 200,
) {
  try {
    return jsonData(callback((await request.json()) as never), status);
  } catch (error) {
    return jsonError(error);
  }
}

function resolveDemoProfile(request: Request) {
  const userId = request.headers.get("x-demo-user-id");
  const user = userId
    ? mockUserProfiles.find((profile) => profile.id === userId)
    : undefined;

  if (user) {
    return user;
  }

  const roleHeader = request.headers.get("x-demo-role");
  const role: UserRole = isUserRole(roleHeader) ? roleHeader : "admin";

  return {
    deniedPermissions: [],
    email: `${role}@example.com`,
    grantedPermissions: [],
    id: `user-${role}`,
    isActive: true,
    name: `Usuario ${role}`,
    role,
  };
}

export const mswHandlers = [
  http.get("/api/auth/me", ({ request }) => {
    const profile = resolveDemoProfile(request);

    return jsonData({
      deniedPermissions: profile.deniedPermissions ?? [],
      grantedPermissions: profile.grantedPermissions ?? [],
      permissionCatalog: permissions,
      permissions: getEffectivePermissions(profile),
      role: profile.role,
      roles: userRoles,
      user: {
        email: profile.email,
        id: profile.id,
        isActive: profile.isActive,
        name: profile.name,
      },
    });
  }),
  http.post("/api/auth/logout", () => jsonData({ signedOut: true })),
  http.post("/api/auth/login", async ({ request }) => {
    const input = (await request.json()) as { email?: string; password?: string };

    if (!input.email || !input.password) {
      return jsonError(new ApiError(400, "VALIDATION_ERROR", "Credenciales invalidas."));
    }

    return jsonData({
      role: "admin",
      user: {
        email: input.email,
        id: "user-admin",
        isActive: true,
        name: "Administrador",
      },
    });
  }),
  http.get("/api/dashboard/summary", () =>
    fromService(() => getDashboardSummary()),
  ),
  http.get("/api/dashboard/metrics", ({ request }) =>
    fromService(() => getDashboardMetrics(searchParams(request))),
  ),
  http.get("/api/dashboard/recent-sales", ({ request }) =>
    fromService(() => getRecentSales(searchParams(request))),
  ),
  http.get("/api/dashboard/low-stock", ({ request }) =>
    fromService(() => getDashboardLowStock(searchParams(request))),
  ),
  http.get("/api/contacts", ({ request }) =>
    fromService(() => listContacts(searchParams(request))),
  ),
  http.post("/api/contacts", async ({ request }) => fromJson(request, createContact, 201)),
  http.get("/api/contacts/:id", ({ params }) =>
    fromService(() => getContactById(String(params.id))),
  ),
  http.patch("/api/contacts/:id", async ({ params, request }) =>
    fromJson(request, (input) => updateContact(String(params.id), input)),
  ),
  http.get("/api/contacts/:id/activity", ({ params, request }) =>
    fromService(() => getContactActivity(String(params.id), searchParams(request))),
  ),
  http.get("/api/contacts/:id/sales", ({ params, request }) =>
    fromService(() => getContactSales(String(params.id), searchParams(request))),
  ),
  http.get("/api/contacts/:id/purchases", ({ params, request }) =>
    fromService(() => getContactPurchases(String(params.id), searchParams(request))),
  ),
  http.get("/api/contacts/:id/payments", ({ params, request }) =>
    fromService(() => getContactPayments(String(params.id), searchParams(request))),
  ),
  http.get("/api/inventory", ({ request }) =>
    fromService(() => listInventory(searchParams(request))),
  ),
  http.get("/api/inventory/movements", ({ request }) =>
    fromService(() => listStockMovements(searchParams(request))),
  ),
  http.get("/api/inventory/stock-card", ({ request }) =>
    fromService(() => getStockCard(searchParams(request))),
  ),
  http.post("/api/inventory/adjustments", async ({ request }) =>
    fromJson(request, createStockAdjustment, 201),
  ),
  http.get("/api/sales", ({ request }) =>
    fromService(() => listSales(searchParams(request))),
  ),
  http.post("/api/sales", async ({ request }) => fromJson(request, createSale, 201)),
  http.get("/api/sales/:id", ({ params }) =>
    fromService(() => getSaleById(String(params.id))),
  ),
  http.patch("/api/sales/:id/cancel", ({ params }) =>
    fromService(() => cancelSale(String(params.id))),
  ),
  http.post("/api/sales/:id/return", ({ params }) =>
    fromService(() => returnSale(String(params.id))),
  ),
  http.get("/api/sales/:id/receipt", ({ params }) =>
    fromService(() => getSaleReceipt(String(params.id))),
  ),
  http.get("/api/purchases", ({ request }) =>
    fromService(() => listPurchases(searchParams(request))),
  ),
  http.post("/api/purchases", async ({ request }) =>
    fromJson(request, createPurchase, 201),
  ),
  http.get("/api/purchases/:id", ({ params }) =>
    fromService(() => getPurchaseById(String(params.id))),
  ),
  http.patch("/api/purchases/:id/cancel", ({ params }) =>
    fromService(() => cancelPurchase(String(params.id))),
  ),
  http.post("/api/purchases/:id/return", ({ params }) =>
    fromService(() => returnPurchase(String(params.id))),
  ),
  http.get("/api/payments", ({ request }) =>
    fromService(() => listPayments(searchParams(request))),
  ),
  http.post("/api/payments", async ({ request }) => fromJson(request, createPayment, 201)),
  http.get("/api/payments/:id", ({ params }) =>
    fromService(() => getPaymentById(String(params.id))),
  ),
  http.get("/api/reports/daily-sales", ({ request }) =>
    fromService(() => getDailySalesReport(searchParams(request))),
  ),
  http.get("/api/reports/gross-profit", ({ request }) =>
    fromService(() => getGrossProfitReport(searchParams(request))),
  ),
  http.get("/api/reports/product-profitability", ({ request }) =>
    fromService(() => getProductProfitabilityReport(searchParams(request))),
  ),
  http.get("/api/reports/low-stock", ({ request }) =>
    fromService(() => getLowStockReport(searchParams(request))),
  ),
  http.get("/api/reports/customer-purchases", ({ request }) =>
    fromService(() => getCustomerPurchasesReport(searchParams(request))),
  ),
  http.get("/api/reports/supplier-purchases", ({ request }) =>
    fromService(() => getSupplierPurchasesReport(searchParams(request))),
  ),
  http.get("/api/reports/stock-card", ({ request }) =>
    fromService(() => getStockCardReport(searchParams(request))),
  ),
  http.get("/api/reports/top-products", ({ request }) =>
    fromService(() => getTopProductsReport(searchParams(request))),
  ),
  http.get("/api/reports/top-customers", ({ request }) =>
    fromService(() => getTopCustomersReport(searchParams(request))),
  ),
  http.get("/api/reports/purchases", ({ request }) =>
    fromService(() => getPurchasesReport(searchParams(request))),
  ),
  http.get("/api/settings", () => fromService(() => getSettings())),
  http.patch("/api/settings", async ({ request }) => fromJson(request, updateSettings)),
  http.get("/api/users", ({ request }) => fromService(() => listUsers(searchParams(request)))),
  http.patch("/api/users/:id", async ({ params, request }) =>
    fromJson(request, (input) => updateUser(String(params.id), input)),
  ),
  http.get("/api/exchange-rates", ({ request }) =>
    fromService(() => listExchangeRates(searchParams(request))),
  ),
  http.get("/api/exchange-rates/current", () =>
    fromService(() => getCurrentExchangeRate()),
  ),
  http.post("/api/exchange-rates", async ({ request }) =>
    fromJson(request, createExchangeRate, 201),
  ),
  http.get("/api/products", ({ request }) =>
    fromService(() => listProducts(searchParams(request))),
  ),
  http.post("/api/products", async ({ request }) => fromJson(request, createProduct, 201)),
  http.get("/api/products/:id", ({ params }) =>
    fromService(() => getProductById(String(params.id))),
  ),
  http.patch("/api/products/:id", async ({ params, request }) =>
    fromJson(request, (input) => updateProduct(String(params.id), input)),
  ),
  http.post("/api/products/:id/price", async ({ params, request }) => {
    const input = (await request.json()) as { salePriceRef: number };

    return fromService(() => ({
      history: {
        createdAt: new Date().toISOString(),
        id: `price-story-${Date.now()}`,
        productId: String(params.id),
        salePriceRef: input.salePriceRef,
        userId: "storybook",
      },
      product: updateProductPrice(String(params.id), input),
    }));
  }),
  http.get("/api/products/:id/price-history", ({ params, request }) =>
    fromService(() => getProductPriceHistory(String(params.id), searchParams(request))),
  ),
  http.get("/api/products/:id/suppliers", ({ params, request }) =>
    fromService(() => listProductSuppliers(String(params.id), searchParams(request))),
  ),
  http.get("/api/categories", ({ request }) =>
    fromService(() => listCategories(searchParams(request))),
  ),
  http.post("/api/categories", async ({ request }) => fromJson(request, createCategory, 201)),
  http.get("/api/supplier-products", ({ request }) =>
    fromService(() => listSupplierProducts(searchParams(request))),
  ),
  http.post("/api/supplier-products", async ({ request }) =>
    fromJson(request, createSupplierProduct, 201),
  ),
  http.patch("/api/supplier-products/:id", async ({ params, request }) =>
    fromJson(request, (input) => updateSupplierProduct(String(params.id), input)),
  ),
  http.get("/api/supplier-products/:id", ({ params }) =>
    fromService(() => getSupplierProductById(String(params.id))),
  ),
  http.get("/api/suppliers/:id/products", ({ params, request }) =>
    fromService(() =>
      listSupplierProductsBySupplier(String(params.id), searchParams(request)),
    ),
  ),
];
