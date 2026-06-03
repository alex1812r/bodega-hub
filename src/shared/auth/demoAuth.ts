import { isUserRole, type UserRole } from "@/shared/auth/permissions";

export const demoRoleStorageKey = "control-ventas:user-role";
export const demoUserIdStorageKey = "control-ventas:user-id";

export function getStoredDemoRole(): UserRole | null {
  if (typeof window === "undefined") {
    return null;
  }

  const storedRole = window.localStorage.getItem(demoRoleStorageKey);

  return isUserRole(storedRole) ? storedRole : null;
}

export function getStoredDemoUserId() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(demoUserIdStorageKey);
}

export function setStoredDemoRole(role: UserRole) {
  window.localStorage.setItem(demoRoleStorageKey, role);
  window.dispatchEvent(
    new StorageEvent("storage", {
      key: demoRoleStorageKey,
      newValue: role,
    }),
  );
}

export function clearStoredDemoAuth() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(demoRoleStorageKey);
  window.localStorage.removeItem(demoUserIdStorageKey);
}
