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

  const storedTheme = window.localStorage.getItem(themeStorageKey);

  return isTheme(storedTheme) ? storedTheme : "light";
}

export function applyTheme(theme: Theme) {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.classList.remove("light", "dark");
  document.documentElement.classList.add(theme);
  document.documentElement.style.colorScheme = theme;
}
