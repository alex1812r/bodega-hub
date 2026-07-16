import { ApiError } from "@/lib/api/apiError";
import { assertMockStoreResource } from "@/lib/api/assertStoreResource";
import { paginateList } from "@/lib/api/pagination";
import {
  mockContacts,
  mockPayments,
  mockPurchases,
  mockSales,
  type ContactMock,
} from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

export type ContactInput = Partial<
  Pick<ContactMock, "address" | "email" | "isActive" | "name" | "phone" | "taxId" | "type">
>;

export function listContacts(searchParams: URLSearchParams, storeId: string) {
  const type = searchParams.get("type");
  const search = searchParams.get("search")?.toLowerCase();

  const isActive = searchParams.get("isActive");

  const items = mockContacts.filter((contact) => {
    const matchesStore = (contact.storeId ?? DEFAULT_STORE_ID) === storeId;
    const matchesType = !type || contact.type === type || contact.type === "ambos";
    const matchesSearch =
      !search ||
      [contact.name, contact.taxId, contact.phone].some((value) =>
        value.toLowerCase().includes(search),
      );
    const matchesActive =
      isActive === null || isActive === "" || String(contact.isActive) === isActive;

    return matchesStore && matchesType && matchesSearch && matchesActive;
  });

  return paginateList(items, searchParams);
}

export function getContactById(id: string, storeId: string) {
  const contact = mockContacts.find((item) => item.id === id);
  assertMockStoreResource(contact, storeId, "Contacto no encontrado.");

  return contact;
}

export function createContact(input: ContactInput, storeId: string) {
  if (input.taxId && mockContacts.some((contact) => contact.taxId === input.taxId)) {
    throw new ApiError(409, "CONFLICT", "Ya existe un contacto con este RIF/CI.");
  }

  return {
    address: input.address ?? "",
    email: input.email ?? "",
    id: `cont-mock-${Date.now()}`,
    isActive: true,
    name: input.name ?? "Contacto mock",
    phone: input.phone ?? "",
    storeId,
    taxId: input.taxId ?? `MOCK-${Date.now()}`,
    type: input.type ?? "cliente",
  } satisfies ContactMock;
}

export function updateContact(id: string, input: ContactInput, storeId: string) {
  if (
    input.taxId &&
    mockContacts.some((contact) => contact.id !== id && contact.taxId === input.taxId)
  ) {
    throw new ApiError(409, "CONFLICT", "Ya existe un contacto con este RIF/CI.");
  }

  return {
    ...getContactById(id, storeId),
    ...input,
  };
}

export function getContactSales(id: string, searchParams: URLSearchParams, storeId: string) {
  getContactById(id, storeId);
  const items = mockSales.filter(
    (sale) => sale.customerId === id && (sale.storeId ?? DEFAULT_STORE_ID) === storeId,
  );

  return paginateList(items, searchParams);
}

export function getContactPurchases(id: string, searchParams: URLSearchParams, storeId: string) {
  getContactById(id, storeId);
  const items = mockPurchases.filter(
    (purchase) =>
      purchase.supplierId === id && (purchase.storeId ?? DEFAULT_STORE_ID) === storeId,
  );

  return paginateList(items, searchParams);
}

export function getContactPayments(id: string, searchParams: URLSearchParams, storeId: string) {
  getContactById(id, storeId);
  const items = mockPayments.filter(
    (payment) =>
      payment.contactId === id && (payment.storeId ?? DEFAULT_STORE_ID) === storeId,
  );

  return paginateList(items, searchParams);
}

export function getContactActivity(id: string, searchParams: URLSearchParams, storeId: string) {
  getContactById(id, storeId);
  const sales = mockSales
    .filter(
      (sale) => sale.customerId === id && (sale.storeId ?? DEFAULT_STORE_ID) === storeId,
    )
    .map((sale) => ({
      amountVes: sale.totalVes,
      createdAt: sale.createdAt,
      id: sale.id,
      type: "sale",
    }));
  const purchases = mockPurchases
    .filter(
      (purchase) =>
        purchase.supplierId === id && (purchase.storeId ?? DEFAULT_STORE_ID) === storeId,
    )
    .map((purchase) => ({
      amountVes: purchase.totalVes,
      createdAt: purchase.createdAt,
      id: purchase.id,
      type: "purchase",
    }));
  const payments = mockPayments
    .filter(
      (payment) =>
        payment.contactId === id && (payment.storeId ?? DEFAULT_STORE_ID) === storeId,
    )
    .map((payment) => ({
      amountVes: payment.amountVes,
      createdAt: payment.createdAt,
      id: payment.id,
      type: "payment",
    }));

  const items = [...sales, ...purchases, ...payments].sort((first, second) =>
    first.createdAt.localeCompare(second.createdAt),
  );

  return paginateList(items, searchParams);
}
