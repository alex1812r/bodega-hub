/**
 * Estado en memoria de los servicios mock, anclado a `globalThis`.
 *
 * `next dev` recompila y vuelve a evaluar los modulos del servidor al navegar,
 * asi que un `const items: X[] = []` a nivel de modulo se vacia solo: se guarda
 * una comision y al cambiar de pantalla ya no esta. Anclando el estado a
 * `globalThis` sobrevive a la recompilacion y el mock se puede recorrer como una
 * aplicacion de verdad (y demostrar sin una base de datos detras).
 *
 * En produccion no cambia nada: `resolveDataSource()` usa Supabase y estos
 * modulos ni se cargan.
 */
const registry = globalThis as typeof globalThis & {
  __bodegaHubMockState?: Map<string, unknown>;
};

registry.__bodegaHubMockState ??= new Map<string, unknown>();

/**
 * Devuelve el valor guardado bajo `key`, creandolo con `create()` la primera vez.
 * La clave debe ser unica por modulo (por ejemplo `"payroll:items"`).
 */
export function mockState<T>(key: string, create: () => T): T {
  const store = registry.__bodegaHubMockState;

  if (!store) {
    return create();
  }

  if (!store.has(key)) {
    store.set(key, create());
  }

  return store.get(key) as T;
}
