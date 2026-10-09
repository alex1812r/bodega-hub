/**
 * @jest-environment node
 */

jest.mock("../../../lib/supabase/route-client");
jest.mock("../../../lib/supabase/admin-client");

import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import {
  CASH_CLOSE_DIFF_ALERT_RANGE_MESSAGE,
  CASH_CLOSE_DIFF_ALERT_UNAVAILABLE_MESSAGE,
} from "./cashCloseSettings.schemas";
import { getCashCloseSettings, getSettings, updateSettings } from "./settings.server";

const OTHER_STORE_ID = "00000000-0000-4000-8000-000000000002";
const COLUMN = "cash_close_diff_alert_ves";

const baseRow = {
  business_name: "BodegaHub",
  default_tax_rate: "16.00",
  default_tax_rate_id: null,
  enabled_payment_methods: ["efectivo_ves"],
  id: 1,
  invoice_prefix: "FAC",
  low_stock_threshold: 5,
  margin_green_from_pct: "25.00",
  margin_yellow_from_pct: "15.00",
  markup_chips_pct: ["12.00", "20.00", "30.00"],
};

/** Lo que responde una base SIN el parche 20261015a al leer la columna. */
const missingOnRead = {
  code: "42703",
  message: `column app_settings.${COLUMN} does not exist`,
};
/** Lo que responde PostgREST al escribir una columna que no está en su caché. */
const missingOnWrite = {
  code: "PGRST204",
  message: `Could not find the '${COLUMN}' column of 'app_settings' in the schema cache`,
};

type Call = {
  filters: Array<[string, unknown]>;
  op: "select" | "update";
  payload?: Record<string, unknown>;
  selected?: string;
};

type Answer = { data: unknown; error: unknown };

/**
 * Cliente falso de `app_settings`: registra cada consulta y la responde con
 * `answer(call)`, que decide según las columnas pedidas y lo que se escribe.
 */
function mountClient(answer: (call: Call) => Answer) {
  const calls: Call[] = [];
  const from = jest.fn(() => {
    const call: Call = { filters: [], op: "select" };
    calls.push(call);
    const builder = {
      eq: (column: string, value: unknown) => {
        call.filters.push([column, value]);
        return builder;
      },
      maybeSingle: () => Promise.resolve(answer(call)),
      select: (columns: string) => {
        call.selected = columns;
        return builder;
      },
      update: (payload: Record<string, unknown>) => {
        call.op = "update";
        call.payload = payload;
        return builder;
      },
    };

    return builder;
  });

  (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "user-admin" } }, error: null }) },
    from,
    rpc: jest.fn(),
  });

  return calls;
}

/** Base con el parche: toda consulta responde la fila con el umbral guardado. */
function patchedBase(threshold: string) {
  return mountClient(() => ({ data: { ...baseRow, [COLUMN]: threshold }, error: null }));
}

/** Base sin el parche: falla todo lo que nombre la columna, al leerla o al escribirla. */
function unpatchedBase() {
  return mountClient((call) => {
    if (call.payload && COLUMN in call.payload) {
      return { data: null, error: missingOnWrite };
    }

    if (call.selected?.includes(COLUMN)) {
      return { data: null, error: missingOnRead };
    }

    return { data: baseRow, error: null };
  });
}

describe("settings.server · umbral de faltante al cerrar caja (CNF-10)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("getSettings expone cashCloseDiffAlertVes como número, de la tienda del servidor", async () => {
    const calls = patchedBase("150.50");

    await expect(getSettings(OTHER_STORE_ID)).resolves.toEqual(
      expect.objectContaining({ cashCloseDiffAlertVes: 150.5, invoicePrefix: "FAC" }),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].filters).toEqual([["store_id", OTHER_STORE_ID]]);
    expect(calls[0].selected).toContain(COLUMN);
  });

  it("getCashCloseSettings lee solo esa columna, una vez, filtrando por la tienda", async () => {
    const calls = patchedBase("20.00");

    await expect(getCashCloseSettings(OTHER_STORE_ID)).resolves.toEqual({ cashCloseDiffAlertVes: 20 });
    expect(calls).toEqual([
      { filters: [["store_id", OTHER_STORE_ID]], op: "select", selected: COLUMN },
    ]);
  });

  it("una tienda sin fila de configuración usa 0 (sin 404)", async () => {
    mountClient(() => ({ data: null, error: null }));

    await expect(getCashCloseSettings(DEFAULT_STORE_ID)).resolves.toEqual({ cashCloseDiffAlertVes: 0 });
  });

  it("updateSettings escribe el umbral normalizado a dos decimales en la fila de la tienda", async () => {
    const calls = patchedBase("99.99");

    await expect(updateSettings({ cashCloseDiffAlertVes: 99.994 }, OTHER_STORE_ID)).resolves.toEqual(
      expect.objectContaining({ cashCloseDiffAlertVes: 99.99 }),
    );
    expect(calls).toEqual([
      expect.objectContaining({
        filters: [["store_id", OTHER_STORE_ID]],
        op: "update",
        payload: { [COLUMN]: 99.99, updated_by: "user-admin" },
      }),
    ]);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    "un umbral inválido (%s) responde 400 sin abrir ninguna consulta",
    async (cashCloseDiffAlertVes) => {
      const calls = patchedBase("0.00");

      await expect(updateSettings({ cashCloseDiffAlertVes }, DEFAULT_STORE_ID)).rejects.toEqual(
        expect.objectContaining({
          code: "BAD_REQUEST",
          message: CASH_CLOSE_DIFF_ALERT_RANGE_MESSAGE,
          status: 400,
        }),
      );
      expect(calls).toEqual([]);
    },
  );

  it("sin el campo en la entrada no toca la columna", async () => {
    const calls = patchedBase("150.00");

    await updateSettings({ invoicePrefix: "FAC" }, DEFAULT_STORE_ID);

    expect(calls[0].payload).toEqual({ invoice_prefix: "FAC", updated_by: "user-admin" });
  });
});

describe("settings.server · base SIN el parche 20261015a", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("getSettings no falla: repite la lectura sin la columna y el umbral vale 0", async () => {
    const calls = unpatchedBase();

    await expect(getSettings(DEFAULT_STORE_ID)).resolves.toEqual(
      expect.objectContaining({ businessName: "BodegaHub", cashCloseDiffAlertVes: 0 }),
    );
    expect(calls).toHaveLength(2);
    expect(calls[1].selected).not.toContain(COLUMN);
    expect(calls[1].filters).toEqual([["store_id", DEFAULT_STORE_ID]]);
  });

  it("getCashCloseSettings responde 0 en vez de 500", async () => {
    unpatchedBase();

    await expect(getCashCloseSettings(DEFAULT_STORE_ID)).resolves.toEqual({ cashCloseDiffAlertVes: 0 });
  });

  it("guardar OTRO ajuste sigue funcionando: se repite sin leer la columna", async () => {
    const calls = unpatchedBase();

    await expect(updateSettings({ invoicePrefix: "FAC" }, DEFAULT_STORE_ID)).resolves.toEqual(
      expect.objectContaining({ cashCloseDiffAlertVes: 0, invoicePrefix: "FAC" }),
    );
    expect(calls.map((call) => [call.op, call.payload, call.selected?.includes(COLUMN)])).toEqual([
      ["update", { invoice_prefix: "FAC", updated_by: "user-admin" }, true],
      ["update", { invoice_prefix: "FAC", updated_by: "user-admin" }, false],
    ]);
  });

  it("guardar el umbral responde 409 con el motivo y no reintenta nada", async () => {
    const calls = unpatchedBase();

    await expect(
      updateSettings({ cashCloseDiffAlertVes: 50, invoicePrefix: "FAC" }, DEFAULT_STORE_ID),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "CONFLICT",
        message: CASH_CLOSE_DIFF_ALERT_UNAVAILABLE_MESSAGE,
        status: 409,
      }),
    );
    expect(calls).toHaveLength(1);
  });

  it("la falta de OTRA columna sigue siendo un error (no se enmascara)", async () => {
    mountClient(() => ({
      data: null,
      error: { code: "42703", message: "column app_settings.markup_chips_pct does not exist" },
    }));

    await expect(getSettings(DEFAULT_STORE_ID)).rejects.toEqual(
      expect.objectContaining({ status: 500 }),
    );
    await expect(getCashCloseSettings(DEFAULT_STORE_ID)).rejects.toEqual(
      expect.objectContaining({ status: 500 }),
    );
  });
});
