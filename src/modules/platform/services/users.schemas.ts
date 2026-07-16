import { z } from "zod";

export const createStoreAdminSchema = z.object({
  email: z.email(),
  fullName: z.string().trim().min(2).max(120),
  password: z.string().min(8).max(128),
  storeId: z.uuid(),
});
