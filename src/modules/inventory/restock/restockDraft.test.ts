/** INV-05 · precarga de la compra de reposición en `sessionStorage` (contrato INV-05). */
import {
  buildRestockPurchaseHref,
  clearRestockDraft,
  readRestockDraft,
  RESTOCK_DRAFT_KEY_PREFIX,
  RESTOCK_DRAFT_MAX_LINES,
  RESTOCK_DRAFT_TTL_MS,
  saveRestockDraft,
  type RestockDraftPayload,
  type RestockDraftSession,
} from "./restockDraft";
import type { RestockLine } from "./restockPlan";

const SESSION: RestockDraftSession = { storeId: "store-1", userId: "user-1" };
const NOW = Date.UTC(2026, 9, 8, 14, 0, 0);

function line(productId: string, overrides: Partial<RestockLine> = {}): RestockLine {
  return {
    currentStock: 2,
    minStock: 5,
    name: `Producto ${productId}`,
    productId,
    sku: productId.toUpperCase(),
    suggestedQuantity: 8,
    ...overrides,
  };
}

const PAYLOAD: RestockDraftPayload = {
  lines: [line("p-1", { lastCostRef: 1.25 }), line("p-2", { currentStock: -3, suggestedQuantity: 13 })],
  supplier: { id: "s-1", name: "Distribuidora Alfa" },
};

function save(payload: RestockDraftPayload = PAYLOAD, session = SESSION, now = NOW) {
  const id = saveRestockDraft(payload, session, now);

  if (id === null) {
    throw new Error("La precarga no se guardó.");
  }

  return id;
}

function storedKeys() {
  return Object.keys(window.sessionStorage).filter((key) => key.startsWith("bodegahub:reposicion:"));
}

describe("restockDraft", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("guarda con clave versionada y la lectura devuelve el mismo payload", () => {
    const id = save();

    expect(storedKeys()).toEqual([`${RESTOCK_DRAFT_KEY_PREFIX}:${id}`]);
    expect(RESTOCK_DRAFT_KEY_PREFIX).toBe("bodegahub:reposicion:v1");
    expect(readRestockDraft(id, SESSION, NOW + 1000)).toEqual({
      draft: { createdAt: NOW, id, ...PAYLOAD },
      status: "ok",
    });
  });

  it("el enlace lleva el id en `restock`", () => {
    expect(buildRestockPurchaseHref("abc-12345")).toBe("/purchases/create?restock=abc-12345");
  });

  it("un grupo sin proveedor viaja sin `supplier`", () => {
    const id = save({ lines: [line("p-1")] });
    const result = readRestockDraft(id, SESSION, NOW);

    expect(result.status).toBe("ok");
    expect(result.status === "ok" && "supplier" in result.draft).toBe(false);
  });

  it("leer no borra: una recarga vuelve a encontrar la precarga", () => {
    const id = save();

    expect(readRestockDraft(id, SESSION, NOW).status).toBe("ok");
    expect(readRestockDraft(id, SESSION, NOW + 5000).status).toBe("ok");
  });

  it("es de un solo uso: tras `clearRestockDraft` ya no existe", () => {
    const id = save();

    clearRestockDraft(id);

    expect(readRestockDraft(id, SESSION, NOW)).toEqual({ status: "missing" });
    expect(storedKeys()).toEqual([]);
  });

  it("caduca a los 30 minutos y se borra al leerla", () => {
    const id = save();

    expect(readRestockDraft(id, SESSION, NOW + RESTOCK_DRAFT_TTL_MS).status).toBe("ok");
    expect(readRestockDraft(id, SESSION, NOW + RESTOCK_DRAFT_TTL_MS + 1)).toEqual({
      status: "expired",
    });
    expect(storedKeys()).toEqual([]);
  });

  it("una fecha de guardado en el futuro también cuenta como caducada", () => {
    const id = save(PAYLOAD, SESSION, NOW + RESTOCK_DRAFT_TTL_MS * 3);

    expect(readRestockDraft(id, SESSION, NOW)).toEqual({ status: "expired" });
  });

  it("no la lee otro usuario ni otra tienda, y se borra", () => {
    const first = save();

    expect(readRestockDraft(first, { storeId: "store-1", userId: "user-2" }, NOW)).toEqual({
      status: "invalid",
    });
    expect(storedKeys()).toEqual([]);

    const second = save();

    expect(readRestockDraft(second, { storeId: "store-2", userId: "user-1" }, NOW)).toEqual({
      status: "invalid",
    });
  });

  it("sin sesión conocida no lee ni borra", () => {
    const id = save();

    expect(readRestockDraft(id, null, NOW)).toEqual({ status: "missing" });
    expect(readRestockDraft(id, SESSION, NOW).status).toBe("ok");
  });

  it("un id desconocido, vacío o con forma rara es `missing`", () => {
    save();

    expect(readRestockDraft("00000000-0000-4000-8000-000000000000", SESSION, NOW)).toEqual({
      status: "missing",
    });
    expect(readRestockDraft("", SESSION, NOW)).toEqual({ status: "missing" });
    expect(readRestockDraft(null, SESSION, NOW)).toEqual({ status: "missing" });
    expect(readRestockDraft("../../etc", SESSION, NOW)).toEqual({ status: "missing" });
  });

  it.each([
    ["JSON ilegible", "{no es json"],
    ["otra versión", (raw: string) => JSON.stringify({ ...JSON.parse(raw), version: 2 })],
    ["sin líneas", (raw: string) => JSON.stringify({ ...JSON.parse(raw), lines: [] })],
    [
      "cantidad no entera",
      (raw: string) =>
        JSON.stringify({ ...JSON.parse(raw), lines: [line("p-1", { suggestedQuantity: 1.5 })] }),
    ],
    [
      "cantidad menor que 1",
      (raw: string) =>
        JSON.stringify({ ...JSON.parse(raw), lines: [line("p-1", { suggestedQuantity: 0 })] }),
    ],
    [
      "producto repetido",
      (raw: string) => JSON.stringify({ ...JSON.parse(raw), lines: [line("p-1"), line("p-1")] }),
    ],
    [
      "proveedor sin nombre",
      (raw: string) => JSON.stringify({ ...JSON.parse(raw), supplier: { id: "s-1", name: "" } }),
    ],
    ["id que no es el de la clave", (raw: string) => JSON.stringify({ ...JSON.parse(raw), id: "otro-id-distinto" })],
  ])("valida con zod al leer: %s → `invalid` y se borra", (_label, corrupt) => {
    const id = save();
    const key = `${RESTOCK_DRAFT_KEY_PREFIX}:${id}`;
    const raw = window.sessionStorage.getItem(key) as string;

    window.sessionStorage.setItem(key, typeof corrupt === "string" ? corrupt : corrupt(raw));

    expect(readRestockDraft(id, SESSION, NOW)).toEqual({ status: "invalid" });
    expect(window.sessionStorage.getItem(key)).toBeNull();
  });

  it("no guarda un payload inválido ni sin sesión", () => {
    expect(saveRestockDraft({ lines: [] }, SESSION, NOW)).toBeNull();
    expect(saveRestockDraft({ lines: [line("p-1", { suggestedQuantity: 0 })] }, SESSION, NOW)).toBeNull();
    expect(saveRestockDraft({ lines: [line("p-1"), line("p-1")] }, SESSION, NOW)).toBeNull();
    expect(
      saveRestockDraft(
        {
          lines: Array.from({ length: RESTOCK_DRAFT_MAX_LINES + 1 }, (_, index) => line(`p-${index}`)),
        },
        SESSION,
        NOW,
      ),
    ).toBeNull();
    expect(saveRestockDraft(PAYLOAD, null, NOW)).toBeNull();
    expect(storedKeys()).toEqual([]);
  });

  it("cabe una compra de 50 productos", () => {
    const lines = Array.from({ length: 50 }, (_, index) => line(`p-${index}`));
    const id = save({ lines, supplier: PAYLOAD.supplier });
    const result = readRestockDraft(id, SESSION, NOW);

    expect(result.status === "ok" && result.draft.lines).toHaveLength(50);
  });

  it("guardar otra precarga reemplaza a la anterior (también de otra versión)", () => {
    const first = save();

    window.sessionStorage.setItem("bodegahub:reposicion:v0:viejo", "{}");
    window.sessionStorage.setItem("bodegahub:otra-cosa", "se queda");

    const second = save({ lines: [line("p-9")] });

    expect(storedKeys()).toEqual([`${RESTOCK_DRAFT_KEY_PREFIX}:${second}`]);
    expect(readRestockDraft(first, SESSION, NOW)).toEqual({ status: "missing" });
    expect(window.sessionStorage.getItem("bodegahub:otra-cosa")).toBe("se queda");
  });

  it("devuelve `null` si el navegador no deja escribir", () => {
    jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });

    expect(saveRestockDraft(PAYLOAD, SESSION, NOW)).toBeNull();
  });
});
