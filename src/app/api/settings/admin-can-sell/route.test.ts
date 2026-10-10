/**
 * @jest-environment node
 *
 * POS-02 · `/api/settings/admin-can-sell`: quién lo cambia, qué habilita y el
 * caos 7.8 (apagarlo con una caja abierta a nombre del administrador).
 */

jest.mock("../../../../lib/supabase/route-client");
jest.mock("../../../../lib/supabase/admin-client");

import { GET as getMe } from "@/app/api/auth/me/route";
import { GET as listRegisters } from "@/app/api/cash/registers/route";
import { POST as closeSession } from "@/app/api/cash/session/close/route";
import { POST as openSession } from "@/app/api/cash/session/open/route";
import { GET as getSession } from "@/app/api/cash/session/route";
import { POST as createSale } from "@/app/api/sales/route";
import { createRouteSupabaseClient } from "@/lib/supabase/route-client";
import {
  createCashRegister,
  listCashRegisters,
  updateCashRegister,
} from "@/modules/cash/services/cash.registers.mock-server";
import {
  closeCashSession,
  getCurrentCashSession,
  openCashSession,
} from "@/modules/cash/services/cash.session.mock-server";
import { mockUserProfiles, type UserProfileMock } from "@/shared/mocks/erp-data";
import { DEFAULT_STORE_ID } from "@/shared/stores/constants";

import { GET, PUT } from "./route";

const URL = "http://localhost/api/settings/admin-can-sell";
const OTHER_STORE_ID = "00000000-0000-4000-8000-000000000002";
const ADMIN = { "x-demo-role": "admin" };
const ADMIN_ID = "user-admin";

function request(url: string, method: string, headers: Record<string, string>, body?: unknown) {
  return new Request(url, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
    method,
  });
}

const put = (enabled: unknown, headers: Record<string, string> = ADMIN) =>
  PUT(request(URL, "PUT", headers, { enabled }));
const get = (headers: Record<string, string> = ADMIN) => GET(request(URL, "GET", headers));
const sell = (headers: Record<string, string> = ADMIN) =>
  createSale(request("http://localhost/api/sales", "POST", headers, {}));
const open = (registerId: string, headers: Record<string, string> = ADMIN) =>
  openSession(request("http://localhost/api/cash/session/open", "POST", headers, { registerId }));
const close = (sessionId: string, headers: Record<string, string> = ADMIN) =>
  closeSession(
    request("http://localhost/api/cash/session/close", "POST", headers, {
      closingRef: 0,
      closingVes: 0,
      sessionId,
    }),
  );

async function myPermissions(headers: Record<string, string> = ADMIN) {
  const response = await getMe(request("http://localhost/api/auth/me", "GET", headers));

  return (await response.json()).data.permissions as string[];
}

let registerCount = 0;

function registerFor(userId: string) {
  registerCount += 1;
  const register = createCashRegister({ name: `Caja POS-02 ${registerCount}` }, DEFAULT_STORE_ID);

  updateCashRegister(register.id, { assignedUserId: userId }, DEFAULT_STORE_ID);

  return register;
}

describe("/api/settings/admin-can-sell (POS-02)", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;
  let snapshot: UserProfileMock[];

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
    jest.clearAllMocks();
    snapshot = mockUserProfiles.map((profile) => ({ ...profile }));
  });

  afterEach(() => {
    mockUserProfiles.splice(0, mockUserProfiles.length, ...snapshot);
  });

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  it("GET: apagado por defecto, con los administradores de la tienda", async () => {
    const response = await get();

    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({
      admins: [{ canSell: false, id: ADMIN_ID, name: "Admin Demo" }],
      enabled: false,
    });
  });

  it.each(["vendedor", "almacen", "contador", "superadmin"])(
    "%s no lo ve ni lo cambia (403) y no se escribe nada",
    async (role) => {
      const headers = { "x-demo-role": role };

      expect((await get(headers)).status).toBe(403);
      expect((await put(true, headers)).status).toBe(403);
      expect((await (await get()).json()).data.enabled).toBe(false);
    },
  );

  it("el admin de otra tienda solo cambia la suya", async () => {
    const response = await put(true, { ...ADMIN, "x-demo-store-id": OTHER_STORE_ID });

    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({
      admins: [{ canSell: true, id: "user-sur-admin", name: "Admin Bodega Sur" }],
      enabled: true,
    });
    expect((await (await get()).json()).data.enabled).toBe(false);
    expect((await sell()).status).toBe(403);
  });

  it("ignora un storeId enviado por el cliente", async () => {
    const response = await PUT(
      request(`${URL}?storeId=${OTHER_STORE_ID}`, "PUT", ADMIN, {
        enabled: true,
        storeId: OTHER_STORE_ID,
      }),
    );

    expect((await response.json()).data.enabled).toBe(true);
    expect((await (await get()).json()).data.enabled).toBe(true);
  });

  it.each([[{}], [{ enabled: "si" }], [{ enabled: null }]])(
    "cuerpo inválido %j → 400",
    async (body) => {
      const response = await PUT(request(URL, "PUT", ADMIN, body));

      expect(response.status).toBe(400);
    },
  );

  it("cuerpo vacío o que no es JSON → 400", async () => {
    const empty = await PUT(new Request(URL, { headers: ADMIN, method: "PUT" }));
    const broken = await PUT(new Request(URL, { body: "{no", headers: ADMIN, method: "PUT" }));

    expect(empty.status).toBe(400);
    expect(broken.status).toBe(400);
  });

  it("activar: el admin gana sales.create y cash.operate (menú) y puede vender; desactivar: 403", async () => {
    expect(await myPermissions()).not.toContain("sales.create");
    expect((await sell()).status).toBe(403);

    const on = await put(true);

    expect(on.status).toBe(200);
    expect((await on.json()).data).toEqual({
      admins: [{ canSell: true, id: ADMIN_ID, name: "Admin Demo" }],
      enabled: true,
    });
    expect(await myPermissions()).toEqual(expect.arrayContaining(["sales.create", "cash.operate"]));
    // Pasa el permiso: lo que falla ahora es el cuerpo vacío de la venta.
    expect((await sell()).status).toBe(400);
    // Idempotente.
    expect((await (await put(true)).json()).data.enabled).toBe(true);

    expect((await (await put(false)).json()).data.enabled).toBe(false);
    expect(await myPermissions()).not.toContain("sales.create");
    expect(await myPermissions()).not.toContain("cash.operate");
    expect((await sell()).status).toBe(403);
    // Los demás roles no cambian.
    expect((await sell({ "x-demo-role": "vendedor" })).status).toBe(400);
    expect((await sell({ "x-demo-role": "contador" })).status).toBe(403);
  });

  it("caos · activar sin caja asignada funciona y el POS ve «sin caja», sin 500", async () => {
    expect((await put(true)).status).toBe(200);

    const session = await getSession(request("http://localhost/api/cash/session", "GET", ADMIN));
    const registers = await listRegisters(
      request("http://localhost/api/cash/registers", "GET", ADMIN),
    );

    expect(session.status).toBe(200);
    expect((await session.json()).data).toBeNull();
    expect(registers.status).toBe(200);
    expect(
      ((await registers.json()).data as Array<{ assignedUserId?: string | null }>).some(
        (register) => register.assignedUserId === ADMIN_ID,
      ),
    ).toBe(false);
    expect((await open("caja-que-no-existe")).status).toBe(404);
  });

  describe("caos 7.8 · apagado con una caja abierta a nombre del administrador", () => {
    afterEach(() => {
      const leftover = getCurrentCashSession(ADMIN_ID, DEFAULT_STORE_ID);

      if (leftover) {
        closeCashSession(
          { closingRef: 0, closingVes: 0, sessionId: leftover.id },
          ADMIN_ID,
          DEFAULT_STORE_ID,
        );
      }

      // La caja queda libre para el siguiente caso (un usuario, una caja activa).
      for (const register of listCashRegisters(DEFAULT_STORE_ID)) {
        updateCashRegister(register.id, { assignedUserId: null }, DEFAULT_STORE_ID);
      }
    });

    it("la sesión se puede cerrar; no se puede vender ni abrir otra", async () => {
      const register = registerFor(ADMIN_ID);

      await put(true);

      const opened = await open(register.id);
      const sessionId = (await opened.json()).data.id as string;

      expect(opened.status).toBe(201);

      expect((await put(false)).status).toBe(200);

      expect((await sell()).status).toBe(403);
      expect((await open(register.id)).status).toBe(403);
      // La sigue viendo (cash.view) para poder cerrarla.
      const current = await getSession(request("http://localhost/api/cash/session", "GET", ADMIN));

      expect((await current.json()).data).toMatchObject({ id: sessionId, status: "open" });

      const closed = await close(sessionId);

      expect(closed.status).toBe(200);
      expect((await closed.json()).data).toMatchObject({ id: sessionId, status: "closed" });
      expect(getCurrentCashSession(ADMIN_ID, DEFAULT_STORE_ID)).toBeNull();
      // Cerrada la suya, ya no hay nada que pueda cerrar ni abrir.
      expect((await close(sessionId)).status).toBe(403);
      expect((await open(register.id)).status).toBe(403);
    });

    it("sin cash.operate el admin NO cierra la sesión de otro; el cajero sí cierra la suya", async () => {
      const sellerId = "user-vendedor";
      const sellerRegister = registerFor(sellerId);
      const sellerSession = openCashSession(
        { registerId: sellerRegister.id },
        sellerId,
        DEFAULT_STORE_ID,
      );

      expect((await close(sellerSession.id)).status).toBe(403);
      expect(sellerSession.status).toBe("open");
      expect((await close(sellerSession.id, { "x-demo-role": "contador" })).status).toBe(403);
      expect((await close(sellerSession.id, { "x-demo-role": "almacen" })).status).toBe(403);

      const closed = await close(sellerSession.id, { "x-demo-role": "vendedor" });

      expect(closed.status).toBe(200);
      expect(sellerSession.status).toBe("closed");
    });
  });

  describe("supabase data source", () => {
    const rows = [
      { full_name: "Ana", granted_permissions: [], id: "ana", is_active: true },
      { full_name: "Luis", granted_permissions: [], id: "luis", is_active: true },
    ];
    const mockIn = jest.fn().mockResolvedValue({ error: null });
    const mockUpdate = jest.fn(() => ({ eq: () => ({ eq: () => ({ in: mockIn }) }) }));
    const mockRoleEq = jest.fn().mockResolvedValue({ data: rows, error: null });
    const mockStoreEq = jest.fn(() => ({ eq: mockRoleEq }));

    beforeEach(() => {
      process.env.API_DATA_SOURCE = "supabase";
      (createRouteSupabaseClient as jest.Mock).mockResolvedValue({
        from: () => ({ select: () => ({ eq: mockStoreEq }), update: mockUpdate }),
      });
    });

    it("PUT escribe los permisos de los admin de la tienda de la sesión, una vez", async () => {
      const response = await put(true);

      expect(response.status).toBe(200);
      expect((await response.json()).data).toEqual({
        admins: [
          { canSell: true, id: "ana", name: "Ana" },
          { canSell: true, id: "luis", name: "Luis" },
        ],
        enabled: true,
      });
      expect(mockStoreEq).toHaveBeenCalledWith("store_id", DEFAULT_STORE_ID);
      expect(mockRoleEq).toHaveBeenCalledWith("role", "admin");
      expect(mockUpdate).toHaveBeenCalledTimes(1);
      expect(mockUpdate).toHaveBeenCalledWith({
        granted_permissions: ["sales.create", "cash.operate"],
      });
      expect(mockIn).toHaveBeenCalledWith("id", ["ana", "luis"]);
    });

    it("un vendedor recibe 403 sin tocar la base", async () => {
      expect((await put(true, { "x-demo-role": "vendedor" })).status).toBe(403);
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });
});
