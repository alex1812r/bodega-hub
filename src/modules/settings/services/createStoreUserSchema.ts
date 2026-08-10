import { z } from "zod";

import { storeUserRoles } from "@/shared/auth/permissions";

export const createStoreUserSchema = z.object({
  email: z.string().trim().email(),
  fullName: z.string().trim().min(1),
  password: z.string().min(8),
  role: z.enum(storeUserRoles),
});

export type CreateStoreUserInput = z.infer<typeof createStoreUserSchema>;
