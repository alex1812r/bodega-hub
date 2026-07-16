import { ApiError } from "@/lib/api/apiError";
import { paginateList } from "@/lib/api/pagination";
import { DEFAULT_STORE_ID, DEFAULT_STORE_SLUG } from "@/shared/stores/constants";
import { mockUserProfiles } from "@/shared/mocks/erp-data";

import type {
  CreateStoreInput,
  PlatformStore,
  PlatformStoreDetail,
  PlatformStoreUser,
  UpdateStoreInput,
} from "../types/stores";

const mockStores: Omit<PlatformStore, "usersCount">[] = [
  {
    createdAt: "2026-07-16T12:00:00.000Z",
    id: DEFAULT_STORE_ID,
    name: "BodegaHub",
    notes: "Tienda principal",
    slug: DEFAULT_STORE_SLUG,
    status: "active",
  },
];

function toStore(store: Omit<PlatformStore, "usersCount">): PlatformStore {
  return {
    ...store,
    usersCount: mockUserProfiles.filter((user) => user.storeId === store.id).length,
  };
}

function getStoreOrThrow(id: string) {
  const store = mockStores.find((item) => item.id === id);
  if (!store) throw new ApiError(404, "NOT_FOUND", "Tienda no encontrada.");
  return store;
}

function assertAvailableSlug(slug: string, currentId?: string) {
  if (mockStores.some((item) => item.slug === slug && item.id !== currentId)) {
    throw new ApiError(409, "CONFLICT", "El slug ya está en uso.");
  }
}

export function listStores(searchParams: URLSearchParams) {
  const search = searchParams.get("search")?.trim().toLowerCase();
  const status = searchParams.get("status");
  const items = mockStores
    .filter((store) => !status || store.status === status)
    .filter((store) => !search || `${store.name} ${store.slug}`.toLowerCase().includes(search))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map(toStore);
  return paginateList(items, searchParams);
}

export function getStore(id: string): PlatformStoreDetail {
  const store = getStoreOrThrow(id);
  const users: PlatformStoreUser[] = mockUserProfiles
    .filter((user) => user.storeId === id)
    .map(({ email, id: userId, isActive, name, role }) => ({
      email,
      id: userId,
      isActive,
      name,
      role,
    }));
  return { ...toStore(store), users };
}

export function createStore(input: CreateStoreInput) {
  assertAvailableSlug(input.slug);
  const store = {
    createdAt: new Date().toISOString(),
    id: crypto.randomUUID(),
    name: input.name,
    notes: input.notes ?? null,
    slug: input.slug,
    status: input.status ?? "active",
  } satisfies Omit<PlatformStore, "usersCount">;
  mockStores.push(store);
  mockUserProfiles.push({
    email: input.admin.email,
    id: crypto.randomUUID(),
    isActive: true,
    name: input.admin.fullName,
    role: "admin",
    storeId: store.id,
  });
  return getStore(store.id);
}

export function updateStore(id: string, input: UpdateStoreInput) {
  const store = getStoreOrThrow(id);
  if (input.slug) assertAvailableSlug(input.slug, id);
  Object.assign(store, input);
  return getStore(id);
}
