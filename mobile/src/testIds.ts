/**
 * IDs estables para los flujos E2E. Un unico archivo, como pide la seccion 10
 * del plan: si un flujo falla por un id, se arregla aqui y en un solo sitio.
 */
export const testIds = {
  login: {
    screen: "login-screen",
    email: "login-email",
    password: "login-password",
    submit: "login-submit",
    error: "login-error",
    logo: "login-logo",
  },
  tabs: {
    bar: "tab-bar",
    item: (key: string) => `tab-${key}`,
  },
  state: {
    loading: "state-loading",
    empty: "state-empty",
    error: "state-error",
    retry: "state-retry",
    forbidden: "state-forbidden",
    offline: "offline-banner",
  },
  dev: {
    screen: "dev-screen",
    role: (role: string) => `dev-role-${role}`,
  },
} as const;
