import { ApiError } from "@/lib/api/apiError";
import { assertMockStoreResource } from "@/lib/api/assertStoreResource";
import { paginateList } from "@/lib/api/pagination";
import {
  mockAppSettings,
  mockUserProfiles,
  type AppSettingsMock,
  type UserProfileMock,
} from "@/shared/mocks/erp-data";

import type { CreateStoreUserInput } from "./createStoreUserSchema";

export type SettingsInput = Partial<AppSettingsMock>;
export type UserProfileInput = Partial<
  Pick<UserProfileMock, "deniedPermissions" | "grantedPermissions" | "isActive" | "name" | "role">
>;

export function getSettings(storeId: string) {
  return {
    ...mockAppSettings,
    storeId: mockAppSettings.storeId ?? storeId,
  };
}

export function updateSettings(input: SettingsInput, storeId: string) {
  return {
    ...getSettings(storeId),
    ...input,
    storeId,
  };
}

export function listUsers(searchParams: URLSearchParams, storeId: string) {
  const items = mockUserProfiles.filter((profile) => profile.storeId === storeId);

  return paginateList(items, searchParams);
}

export function updateUser(id: string, input: UserProfileInput, storeId: string) {
  const user = mockUserProfiles.find((profile) => profile.id === id);
  assertMockStoreResource(
    user ? { storeId: user.storeId ?? undefined } : null,
    storeId,
    "Usuario no encontrado.",
  );

  if (!user || user.storeId == null) {
    throw new ApiError(404, "NOT_FOUND", "Usuario no encontrado.");
  }

  Object.assign(user, input);

  return {
    ...user,
  };
}

export function createUser(input: CreateStoreUserInput, storeId: string) {
  const email = input.email.trim().toLowerCase();

  if (mockUserProfiles.some((profile) => profile.email.toLowerCase() === email)) {
    throw new ApiError(409, "CONFLICT", "Ya existe un usuario con este correo.");
  }

  const user: UserProfileMock = {
    email,
    id: `user-mock-${Date.now()}`,
    isActive: true,
    name: input.fullName.trim(),
    role: input.role,
    storeId,
  };

  mockUserProfiles.push(user);
  return user;
}
