/**
 * Doble de PostgREST en memoria para los tests de los servicios de Reportes y
 * del dashboard. A diferencia de un `jest.fn()` que devuelve siempre lo mismo,
 * respeta lo que hace fallar a los servicios con datos reales:
 *
 * - filtra (`eq`, `neq`, `in`, `not`, `gte`, `lt`, `lte`), ordena y aplica
 *   `range` / `limit`;
 * - corta cada respuesta en `maxRows` filas (1.000 en PostgREST);
 * - responde "URI too long" si los valores de los filtros no caben en la URL;
 * - responde 416 / `PGRST103` a un `range` que empieza más allá del total.
 */

type Row = Record<string, unknown>;

type FakeResult = {
  count: number | null;
  data: Row[] | null;
  error: { code?: string; message: string } | null;
  status: number;
};

export type FakePostgrestRequest = {
  /** Nº de valores del mayor filtro `in` de la petición. */
  largestInList: number;
  table: string;
  /** Longitud aproximada de los filtros en la URL. */
  urlLength: number;
};

export type FakePostgrestOptions = {
  /** Tope de filas por respuesta (`max-rows` de PostgREST). */
  maxRows?: number;
  /** Longitud de filtros a partir de la cual el servidor responde "URI too long". */
  uriLimit?: number;
};

const DEFAULT_MAX_ROWS = 1000;
/** 334 uuid (37 caracteres con la coma) son ~12 kB: el fallo real aparece ahí. */
const DEFAULT_URI_LIMIT = 8000;

function compareValues(first: unknown, second: unknown) {
  if (first === second) {
    return 0;
  }

  if (typeof first === "number" && typeof second === "number") {
    return first - second;
  }

  return String(first) < String(second) ? -1 : 1;
}

class FakeQuery implements PromiseLike<FakeResult> {
  private readonly filters: Array<(row: Row) => boolean> = [];
  private readonly orders: Array<{ ascending: boolean; column: string }> = [];
  private columns = "*";
  private wantsCount = false;
  private head = false;
  private window: { from: number; to: number } | null = null;
  private rowLimit: number | null = null;
  private urlLength = 0;
  private largestInList = 0;

  constructor(
    private readonly table: string,
    private readonly rows: readonly Row[],
    private readonly options: Required<FakePostgrestOptions>,
    private readonly log: FakePostgrestRequest[],
  ) {}

  select(columns = "*", options?: { count?: "exact"; head?: boolean }) {
    this.columns = columns;
    this.wantsCount = options?.count === "exact";
    this.head = options?.head === true;

    return this;
  }

  private addFilter(column: string, value: string, test: (row: Row) => boolean) {
    this.filters.push(test);
    this.urlLength += column.length + value.length + 5;

    return this;
  }

  eq(column: string, value: unknown) {
    return this.addFilter(column, String(value), (row) => row[column] === value);
  }

  neq(column: string, value: unknown) {
    return this.addFilter(column, String(value), (row) => row[column] !== value);
  }

  in(column: string, values: readonly unknown[]) {
    const set = new Set(values);
    this.largestInList = Math.max(this.largestInList, values.length);

    return this.addFilter(column, values.join(","), (row) => set.has(row[column]));
  }

  not(column: string, operator: string, value: unknown) {
    if (operator === "is" && value === null) {
      return this.addFilter(column, "null", (row) => row[column] != null);
    }

    if (operator === "in" && typeof value === "string") {
      const excluded = new Set(value.replace(/^\(|\)$/g, "").split(","));

      return this.addFilter(column, value, (row) => !excluded.has(String(row[column])));
    }

    throw new Error(`fakePostgrest: not(${operator}) no está implementado`);
  }

  gte(column: string, value: string) {
    return this.addFilter(column, value, (row) => String(row[column]) >= value);
  }

  lt(column: string, value: string) {
    return this.addFilter(column, value, (row) => String(row[column]) < value);
  }

  lte(column: string, value: string) {
    return this.addFilter(column, value, (row) => String(row[column]) <= value);
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orders.push({ ascending: options?.ascending ?? true, column });

    return this;
  }

  range(from: number, to: number) {
    this.window = { from, to };

    return this;
  }

  limit(count: number) {
    this.rowLimit = count;

    return this;
  }

  async maybeSingle() {
    const result = this.run();

    return { ...result, data: result.data?.[0] ?? null };
  }

  private project(row: Row): Row {
    if (this.columns.trim() === "*") {
      return { ...row };
    }

    return Object.fromEntries(
      this.columns.split(",").map((column) => [column.trim(), row[column.trim()]]),
    );
  }

  private run(): FakeResult {
    this.log.push({
      largestInList: this.largestInList,
      table: this.table,
      urlLength: this.urlLength,
    });

    if (this.urlLength > this.options.uriLimit) {
      return { count: null, data: null, error: { message: "URI too long" }, status: 414 };
    }

    const matching = this.rows.filter((row) => this.filters.every((test) => test(row)));
    const count = this.wantsCount ? matching.length : null;

    if (this.head) {
      return { count, data: null, error: null, status: 200 };
    }

    const sorted = [...matching].sort((first, second) => {
      for (const { ascending, column } of this.orders) {
        const result = compareValues(first[column], second[column]);

        if (result !== 0) {
          return ascending ? result : -result;
        }
      }

      return 0;
    });
    const offset = this.window?.from ?? 0;

    if (offset > 0 && offset >= matching.length) {
      return {
        count,
        data: null,
        error: { code: "PGRST103", message: "Requested range not satisfiable" },
        status: 416,
      };
    }

    const requested = this.window ? this.window.to - this.window.from + 1 : Infinity;
    const size = Math.min(requested, this.rowLimit ?? Infinity, this.options.maxRows);

    return {
      count,
      data: sorted.slice(offset, offset + size).map((row) => this.project(row)),
      error: null,
      status: 200,
    };
  }

  then<TResult1 = FakeResult, TResult2 = never>(
    onFulfilled?: ((value: FakeResult) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve()
      .then(() => this.run())
      .then(onFulfilled, onRejected);
  }
}

/**
 * Cliente con la forma de `supabase.from(tabla)` sobre tablas en memoria.
 * `requests` anota cada petición ejecutada (para comprobar el troceado).
 */
export function createFakePostgrest(
  tables: Readonly<Record<string, readonly Row[]>>,
  options: FakePostgrestOptions = {},
) {
  const requests: FakePostgrestRequest[] = [];
  const resolved = {
    maxRows: options.maxRows ?? DEFAULT_MAX_ROWS,
    uriLimit: options.uriLimit ?? DEFAULT_URI_LIMIT,
  };

  return {
    client: {
      from: (table: string) => new FakeQuery(table, tables[table] ?? [], resolved, requests),
    },
    requests,
  };
}
