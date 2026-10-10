/**
 * @jest-environment node
 *
 * GQ-06 · `rpcError` reenviaba como 400 el mensaje crudo de CUALQUIER fallo de
 * las RPC de caja. Solo los rechazos de negocio (PT4xx, o `raise exception` sin
 * errcode = P0001) llevan un mensaje redactado para el usuario; el resto es
 * texto de Postgres o de la red: mensaje genérico al cliente y detalle al log.
 */

jest.mock("../../../lib/supabase/route-client");
jest.mock("../../../lib/supabase/admin-client");

import { UNEXPECTED_ERROR_MESSAGE } from "@/lib/supabase/errors";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";

import { closeCashSession, openCashSession } from "./cash.session.server";
import { createCashSupabaseFake } from "./testing/cashSupabaseFake";

const STORE_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "admin-1";
const RAW_POSTGRES_TEXT =
  'column "theoretical_closing_ves" of relation "cash_sessions" does not exist';

function mountRpcFailure(error: { code?: string; message: string }) {
  const fake = createCashSupabaseFake(
    {
      registers: [
        { assigned_user_id: USER_ID, id: "reg-1", is_active: true, name: "Caja 1", store_id: STORE_ID },
      ],
      sessions: [],
    },
    { role: "admin", uid: USER_ID },
  );

  (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
    ...fake.client,
    rpc: jest.fn().mockResolvedValue({ data: null, error }),
  });
}

const operations = [
  ["openCashSession", () => openCashSession({ registerId: "reg-1" }, USER_ID, STORE_ID)],
  [
    "closeCashSession",
    () => closeCashSession({ closingRef: 0, closingVes: 0, sessionId: "s-1" }, USER_ID, STORE_ID),
  ],
] as const;

describe.each(operations)("cash.session.server · errores de la RPC en %s (GQ-06)", (_name, run) => {
  let logged: jest.SpyInstance;

  beforeEach(() => {
    logged = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    logged.mockRestore();
  });

  it("un fallo de Postgres sin mapear responde 500 genérico y deja el detalle en el log", async () => {
    mountRpcFailure({ code: "42703", message: RAW_POSTGRES_TEXT });

    const failure = await run().then(
      () => null,
      (error: unknown) => error as { message: string; status: number },
    );

    expect(failure).toMatchObject({ message: UNEXPECTED_ERROR_MESSAGE, status: 500 });
    expect(JSON.stringify(failure)).not.toContain("cash_sessions");
    expect(logged).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ code: "42703", message: RAW_POSTGRES_TEXT }),
    );
  });

  it("un fallo sin código (red, PostgREST caído) tampoco reenvía su texto", async () => {
    mountRpcFailure({ message: "TypeError: fetch failed (ECONNREFUSED 10.0.0.5:5432)" });

    await expect(run()).rejects.toMatchObject({ message: UNEXPECTED_ERROR_MESSAGE, status: 500 });
  });

  it("un rechazo de negocio sin errcode (P0001) conserva su mensaje y el 400", async () => {
    mountRpcFailure({ code: "P0001", message: "La caja ya tiene una sesión abierta" });

    await expect(run()).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "La caja ya tiene una sesión abierta",
      status: 400,
    });
    expect(logged).not.toHaveBeenCalled();
  });

  it("un rechazo PT409 conserva su mensaje con su propio estado", async () => {
    mountRpcFailure({ code: "PT409", message: "La sesión de caja ya está cerrada" });

    await expect(run()).rejects.toMatchObject({
      code: "CONFLICT",
      message: "La sesión de caja ya está cerrada",
      status: 409,
    });
  });
});
