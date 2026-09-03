/**
 * Tokens de `docs/design-tokens.md`. Ninguna pantalla debe usar colores
 * literales: si falta un tono, se agrega aqui primero.
 */

export const palette = {
  indigo50: "#EEF2FF",
  indigo100: "#E0E7FF",
  indigo500: "#6366F1",
  indigo600: "#4F46E5",
  indigo700: "#4338CA",
  slate50: "#F8FAFC",
  slate100: "#F1F5F9",
  slate200: "#E2E8F0",
  slate300: "#CBD5E1",
  slate400: "#94A3B8",
  slate500: "#64748B",
  slate600: "#475569",
  slate700: "#334155",
  slate800: "#1E293B",
  slate900: "#0F172A",
  slate950: "#020617",
  white: "#FFFFFF",
  emerald50: "#ECFDF5",
  emerald500: "#10B981",
  emerald600: "#059669",
  amber50: "#FFFBEB",
  amber500: "#F59E0B",
  amber600: "#D97706",
  red50: "#FEF2F2",
  red500: "#EF4444",
  red600: "#DC2626",
} as const;

export type ThemeName = "light" | "dark";

export type Theme = {
  name: ThemeName;
  /** Fondo del shell autenticado. */
  appSurface: string;
  /** Fondo de login y pantallas publicas. */
  pageSurface: string;
  card: string;
  cardBorder: string;
  primary: string;
  primaryPressed: string;
  primaryText: string;
  primarySoft: string;
  text: string;
  textMuted: string;
  textSubtle: string;
  border: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  overlay: string;
  tabBar: string;
  tabBarBorder: string;
  tabActive: string;
  tabInactive: string;
};

export const lightTheme: Theme = {
  name: "light",
  appSurface: "#F8F9FF",
  pageSurface: palette.slate50,
  card: palette.white,
  cardBorder: palette.slate200,
  primary: palette.indigo600,
  primaryPressed: palette.indigo700,
  primaryText: palette.white,
  primarySoft: palette.indigo50,
  text: palette.slate900,
  textMuted: palette.slate600,
  textSubtle: palette.slate400,
  border: palette.slate200,
  success: palette.emerald600,
  successSoft: palette.emerald50,
  warning: palette.amber600,
  warningSoft: palette.amber50,
  danger: palette.red600,
  dangerSoft: palette.red50,
  overlay: "rgba(2, 6, 23, 0.4)",
  tabBar: palette.white,
  tabBarBorder: palette.slate200,
  tabActive: palette.indigo600,
  tabInactive: palette.slate500,
};

export const darkTheme: Theme = {
  name: "dark",
  appSurface: palette.slate950,
  pageSurface: palette.slate950,
  card: palette.slate900,
  cardBorder: palette.slate800,
  primary: palette.indigo500,
  primaryPressed: palette.indigo600,
  primaryText: palette.white,
  primarySoft: "#312E81",
  text: palette.slate50,
  textMuted: palette.slate300,
  textSubtle: palette.slate500,
  border: palette.slate800,
  success: palette.emerald500,
  successSoft: "#064E3B",
  warning: palette.amber500,
  warningSoft: "#78350F",
  danger: palette.red500,
  dangerSoft: "#7F1D1D",
  overlay: "rgba(2, 6, 23, 0.6)",
  tabBar: palette.slate900,
  tabBarBorder: palette.slate800,
  tabActive: palette.indigo500,
  tabInactive: palette.slate400,
};

export const themes: Record<ThemeName, Theme> = {
  light: lightTheme,
  dark: darkTheme,
};

/** Escala de espaciado en px. Multiplos de 4, como Tailwind. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
  xl: 24,
  full: 9999,
} as const;

export const typography = {
  title: { fontSize: 24, fontWeight: "700" },
  heading: { fontSize: 18, fontWeight: "600" },
  body: { fontSize: 15, fontWeight: "400" },
  label: { fontSize: 13, fontWeight: "500" },
  caption: { fontSize: 12, fontWeight: "400" },
} as const;

/** Area tactil minima exigida por la seccion 6 del plan. */
export const minTouchSize = 44;
