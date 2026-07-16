import { ApiError } from "@/lib/api/apiError";
import { paginateList } from "@/lib/api/pagination";
import { mockUserProfiles } from "@/shared/mocks/erp-data";

import type { PlatformStore } from "../types/stores";
import type { CreateStoreAdminInput, PlatformUser, PlatformUserDetail } from "../types/users";
import * as storesMock from "./stores.mock-server";

function listKnownStores(): PlatformStore[] {
  return storesMock.listStores(new URLSearchParams("limit=100&skip=0")).items;
}

function toPlatformUser(profile: (typeof mockUserProfiles)[number]): PlatformUser | null {
  if (profile.role === "superadmin") {
    return null;
  }

  const stores = listKnownStores();
  const store = stores.find((item) => item.id === profile.storeId) ?? null;

  return {
    email: profile.email,
    id: profile.id,
    isActive: profile.isActive,
    name: profile.name,
    role: profile.role,
    store: store
      ? { id: store.id, name: store.name, slug: store.slug }
      : profile.storeId
        ? { id: profile.storeId, name: "Tienda", slug: "-" }
        : null,
  };
}

export function listPlatformUsers(searchParams: URLSearchParams) {
  const search = searchParams.get("search")?.trim().toLowerCase();
  const storeId = searchParams.get("storeId");
  const role = searchParams.get("role");

  const items = mockUserProfiles
    .map(toPlatformUser)
    .filter((user): user is PlatformUser => Boolean(user))
    .filter((user) => !storeId || user.store?.id === storeId)
    .filter((user) => !role || user.role === role)
    .filter(
      (user) =>
        !search ||
        `${user.name} ${user.email} ${user.store?.name ?? ""} ${user.store?.slug ?? ""}`
          .toLowerCase()
          .includes(search),
    )
    .sort((left, right) => left.name.localeCompare(right.name, "es"));

  return paginateList(items, searchParams);
}

export function getPlatformUser(id: string): PlatformUserDetail {
  const profile = mockUserProfiles.find((item) => item.id === id);
  if (!profile || profile.role === "superadmin") {
    throw new ApiError(404, "NOT_FOUND", "Usuario no encontrado.");
  }

  const user = toPlatformUser(profile);
  if (!user) {
    throw new ApiError(404, "NOT_FOUND", "Usuario no encontrado.");
  }

  return {
    ...user,
    deniedPermissions: [...(profile.deniedPermissions ?? [])],
    grantedPermissions: [...(profile.grantedPermissions ?? [])],
  };
}

export function createStoreAdmin(input: CreateStoreAdminInput): PlatformUserDetail {
  const stores = listKnownStores();
  const store = stores.find((item) => item.id === input.storeId);
  if (!store) {
    throw new ApiError(404, "NOT_FOUND", "Tienda no encontrada.");
  }

  if (mockUserProfiles.some((profile) => profile.email.toLowerCase() === input.email.toLowerCase())) {
    throw new ApiError(409, "CONFLICT", "Ya existe un usuario con este email.");
  }

  const id = crypto.randomUUID();
  mockUserProfiles.push({
    email: input.email,
    id,
    isActive: true,
    name: input.fullName,
    role: "admin",
    storeId: input.storeId,
  });

  return getPlatformUser(id);
}
