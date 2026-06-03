import { ApiError } from "@/lib/api/apiError";
import { paginateList } from "@/lib/api/pagination";
import {
  mockAppSettings,
  mockUserProfiles,
  type AppSettingsMock,
  type UserProfileMock,
} from "@/shared/mocks/erp-data";

export type SettingsInput = Partial<AppSettingsMock>;
export type UserProfileInput = Partial<
  Pick<UserProfileMock, "deniedPermissions" | "grantedPermissions" | "isActive" | "name" | "role">
>;

export function getSettings() {
  return mockAppSettings;
}

export function updateSettings(input: SettingsInput) {
  return {
    ...mockAppSettings,
    ...input,
  };
}

export function listUsers(searchParams: URLSearchParams) {
  return paginateList(mockUserProfiles, searchParams);
}

export function updateUser(id: string, input: UserProfileInput) {
  const user = mockUserProfiles.find((profile) => profile.id === id);

  if (!user) {
    throw new ApiError(404, "NOT_FOUND", "Usuario no encontrado.");
  }

  return {
    ...user,
    ...input,
  };
}
