import { isUserRole, type UserRole } from "@/shared/auth/permissions";

export const demoRoleStorageKey = "bodega-hub:user-role";
export const demoUserIdStorageKey = "bodega-hub:user-id";
export const demoStoreIdStorageKey = "bodega-hub:demo-store-id";

function readStoredValue(key: string) {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage.getItem(key);
  } catch {
    // Almacenamiento bloqueado (leer `window.localStorage` ya lanza `SecurityError`):
    // equivale a no tener sesion demo guardada; las peticiones salen sin esas cabeceras.
    return null;
  }
}

export function getStoredDemoRole(): UserRole | null {
  const storedRole = readStoredValue(demoRoleStorageKey);

  return isUserRole(storedRole) ? storedRole : null;
}

export function getStoredDemoUserId() {
  return readStoredValue(demoUserIdStorageKey);
}

export function getStoredDemoStoreId() {
  return readStoredValue(demoStoreIdStorageKey);
}

export function setStoredDemoRole(role: UserRole) {
  try {
    window.localStorage.setItem(demoRoleStorageKey, role);
  } catch {
    // `SecurityError` o `QuotaExceededError`: el rol no se guardo, asi que no se anuncia el cambio.
    return;
  }

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

  try {
    window.localStorage.removeItem(demoRoleStorageKey);
    window.localStorage.removeItem(demoUserIdStorageKey);
    window.localStorage.removeItem(demoStoreIdStorageKey);
  } catch {
    // Almacenamiento bloqueado: no hay sesion demo que borrar y el login real debe seguir.
  }
}
