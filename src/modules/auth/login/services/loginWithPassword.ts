import { apiFetch } from "@/shared/api/apiFetch";
import type { UserRole } from "@/shared/auth/permissions";

import { type LoginFormValues } from "../schemas/loginSchema";

export type LoginResponse = {
  role: UserRole;
  user: {
    email?: string;
    id: string;
    isActive: boolean;
    name: string;
  };
};

export async function loginWithPassword(values: LoginFormValues) {
  return apiFetch<LoginResponse>("/api/auth/login", {
    body: values,
    method: "POST",
  });
}
