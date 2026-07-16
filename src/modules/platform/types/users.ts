export type PlatformUserStore = {
  id: string;
  name: string;
  slug: string;
};

export type PlatformUser = {
  email: string;
  id: string;
  isActive: boolean;
  name: string;
  role: string;
  store: PlatformUserStore | null;
};

export type PlatformUserDetail = PlatformUser & {
  deniedPermissions: string[];
  grantedPermissions: string[];
};

export type CreateStoreAdminInput = {
  email: string;
  fullName: string;
  password: string;
  storeId: string;
};
