export type StoreStatus = "active" | "paused";

export type PlatformStore = {
  createdAt: string;
  id: string;
  name: string;
  notes?: string | null;
  slug: string;
  status: StoreStatus;
  usersCount: number;
};

export type PlatformStoreUser = {
  email: string;
  id: string;
  isActive: boolean;
  name: string;
  role: string;
};

export type PlatformStoreDetail = PlatformStore & {
  users: PlatformStoreUser[];
};

export type CreateStoreInput = {
  admin: {
    email: string;
    fullName: string;
    password: string;
    sendCredentialsEmail?: boolean;
  };
  name: string;
  notes?: string;
  slug: string;
  status?: StoreStatus;
};

export type UpdateStoreInput = Partial<Pick<PlatformStore, "name" | "notes" | "slug" | "status">>;
