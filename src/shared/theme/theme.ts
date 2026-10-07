export const themeStorageKey = "bodega-hub:theme";

export const themes = ["light", "dark"] as const;

export type Theme = (typeof themes)[number];

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && themes.includes(value as Theme);
}

export function getStoredTheme(): Theme {
  if (typeof window === "undefined") {
    return "light";
  }

  try {
    const storedTheme = window.localStorage.getItem(themeStorageKey);

    return isTheme(storedTheme) ? storedTheme : "light";
  } catch {
    // Almacenamiento bloqueado (leer `window.localStorage` ya lanza `SecurityError`):
    // la app debe cargar igual, con el tema por defecto.
    return "light";
  }
}

/** Guarda el tema elegido; con el almacenamiento bloqueado o lleno no hace nada. */
export function storeTheme(theme: Theme) {
  try {
    window.localStorage.setItem(themeStorageKey, theme);
  } catch {
    // `SecurityError` o `QuotaExceededError`: el tema vale para esta sesion y no se recuerda.
  }
}

export function applyTheme(theme: Theme) {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.classList.remove("light", "dark");
  document.documentElement.classList.add(theme);
  document.documentElement.style.colorScheme = theme;
}
