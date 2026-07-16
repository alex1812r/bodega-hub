import { ApiError } from "@/lib/api/apiError";
import { assertMockStoreResource } from "@/lib/api/assertStoreResource";
import { paginateList } from "@/lib/api/pagination";
import {
  mockAppSettings,
  mockUserProfiles,
  type AppSettingsMock,
  type UserProfileMock,
} from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

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

  return {
    ...user,
    ...input,
  };
}
