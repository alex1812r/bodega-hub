/**
 * Supabase simulado para las pruebas de sesión de caja (POS-F3). Reproduce lo que
 * hoy hace la base, sin cambiarlo: la RLS de lectura (`20260811b`) y las reglas de
 * `open_cash_session` / `close_cash_session`, que al rol `admin` no le exigen caja
 * asignada ni haber abierto el turno.
 */
export type CashFakeRow = Record<string, unknown>;

export type CashFakeCaller = { role: "admin" | "vendedor"; uid: string };

export type CashFakeState = {
  movements?: CashFakeRow[];
  registers: CashFakeRow[];
  sessions: CashFakeRow[];
};

type CashFakeTable = "cash_movements" | "cash_registers" | "cash_sessions";

type CashFakeResult<T> = { data: T; error: { code: string; message: string } | null };

function rpcRejection(message: string): CashFakeResult<null> {
  return { data: null, error: { code: "P0001", message } };
}

export function createCashSupabaseFake(state: CashFakeState, caller: CashFakeCaller) {
  const rpcCalls: { args: Record<string, unknown>; name: string }[] = [];
  const movements = state.movements ?? [];

  function registerOf(session: CashFakeRow) {
    return state.registers.find((register) => register.id === session.register_id);
  }

  function visibleRows(table: CashFakeTable): CashFakeRow[] {
    const isAdmin = caller.role === "admin";

    if (table === "cash_registers") {
      return state.registers.filter(
        (register) => isAdmin || register.assigned_user_id === caller.uid,
      );
    }

    if (table === "cash_sessions") {
      return state.sessions
        .filter(
          (session) =>
            isAdmin ||
            session.opened_by === caller.uid ||
            registerOf(session)?.assigned_user_id === caller.uid,
        )
        .map((session) => ({ ...session, cash_registers: registerOf(session) }));
    }

    return movements;
  }

  function from(table: CashFakeTable) {
    let rows = visibleRows(table);
    let max: number | undefined;
    const result = () => (max === undefined ? rows : rows.slice(0, max));
    const query = {
      eq(column: string, value: unknown) {
        rows = rows.filter((row) => row[column] === value);
        return query;
      },
      in(column: string, values: unknown[]) {
        rows = rows.filter((row) => values.includes(row[column]));
        return query;
      },
      limit(count: number) {
        max = count;
        return query;
      },
      async maybeSingle(): Promise<CashFakeResult<CashFakeRow | null>> {
        const found = result();

        if (found.length > 1) {
          return {
            data: null,
            error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" },
          };
        }

        return { data: found[0] ?? null, error: null };
      },
      neq(column: string, value: unknown) {
        rows = rows.filter((row) => row[column] !== value);
        return query;
      },
      order(column: string, options: { ascending: boolean }) {
        const direction = options.ascending ? 1 : -1;
        rows = [...rows].sort(
          (left, right) => direction * String(left[column]).localeCompare(String(right[column])),
        );
        return query;
      },
      select() {
        return query;
      },
      then<T>(resolve: (value: CashFakeResult<CashFakeRow[]>) => T) {
        return Promise.resolve({ data: result(), error: null }).then(resolve);
      },
    };

    return query;
  }

  async function rpc(name: string, args: Record<string, unknown>) {
    rpcCalls.push({ args, name });

    if (name === "open_cash_session") {
      const register = state.registers.find((item) => item.id === args.p_register_id);

      if (!register) return rpcRejection("Caja registradora no encontrada");
      if (caller.role === "vendedor" && register.assigned_user_id !== caller.uid) {
        return rpcRejection("La caja no está asignada al vendedor actual");
      }
      if (state.sessions.some((item) => item.register_id === register.id && item.status === "open")) {
        return rpcRejection("La caja ya tiene una sesión abierta");
      }

      const session: CashFakeRow = {
        id: `session-${state.sessions.length + 1}`,
        opened_at: new Date(Date.UTC(2026, 9, 10, 12, 0, state.sessions.length)).toISOString(),
        opened_by: caller.uid,
        opening_ref: args.p_opening_ref,
        opening_ves: args.p_opening_ves,
        register_id: register.id,
        status: "open",
        store_id: register.store_id,
      };
      state.sessions.push(session);

      return { data: session, error: null };
    }

    const session = state.sessions.find((item) => item.id === args.p_session_id);

    if (!session) return rpcRejection("Sesión de caja no encontrada");
    if (session.status !== "open") return rpcRejection("La sesión de caja ya está cerrada");
    if (caller.role !== "admin" && session.opened_by !== caller.uid) {
      return rpcRejection("Solo quien abrió la caja o un administrador puede cerrarla");
    }

    Object.assign(session, {
      closed_by: caller.uid,
      closing_ref: args.p_closing_ref,
      closing_ves: args.p_closing_ves,
      status: "closed",
    });

    return { data: session, error: null };
  }

  return { client: { from, rpc }, rpcCalls };
}
