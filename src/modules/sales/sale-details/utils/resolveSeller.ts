import { roleLabels, type UserRole } from "@/shared/auth/permissions";
import { mockUserProfiles } from "@/shared/mocks/erp-data";

import { getSellerSubtitle } from "./saleDetailLabels";

export type SaleSellerInfo = {
  name: string;
  subtitle: string;
};

export function resolveSeller(userId: string): SaleSellerInfo {
  const profile = mockUserProfiles.find((user) => user.id === userId);

  if (!profile) {
    return { name: "Usuario", subtitle: "—" };
  }

  const role = profile.role as UserRole;

  return {
    name: profile.name,
    subtitle: getSellerSubtitle(role) ?? roleLabels[role],
  };
}
