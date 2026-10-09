/**
 * @jest-environment node
 */

import { assertImpactDocumentId, impactJson, parseImpactAction } from "./impactServer";

const ACTIONS = ["cancel", "return"] as const;

function request(query: string) {
  return new Request(`http://localhost/api/sales/sale-001/impact${query}`);
}

describe("parseImpactAction", () => {
  it("devuelve la acción permitida", () => {
    expect(parseImpactAction(request("?action=cancel"), ACTIONS)).toBe("cancel");
    expect(parseImpactAction(request("?other=1&action=return"), ACTIONS)).toBe("return");
  });

  it.each(["", "?action=", "?action=receive", "?action=CANCEL", "?action=cancel&action=cancel"])(
    "400 con action ausente, repetida o fuera de la lista (%s)",
    (query) => {
      expect(() => parseImpactAction(request(query), ACTIONS)).toThrow(
        expect.objectContaining({
          code: "BAD_REQUEST",
          message: "El parametro action es obligatorio y debe ser uno de: cancel, return.",
          status: 400,
        }),
      );
    },
  );
});

describe("assertImpactDocumentId", () => {
  it("acepta un uuid", () => {
    expect(() => assertImpactDocumentId("22222222-2222-4222-8222-222222222222")).not.toThrow();
  });

  it.each(["", "sale-001", "22222222-2222-4222-8222-222222222222\u0000", "' or 1=1 --"])(
    "400 con un id que no es uuid (%j)",
    (id) => {
      expect(() => assertImpactDocumentId(id)).toThrow(
        expect.objectContaining({ code: "BAD_REQUEST", status: 400 }),
      );
    },
  );
});

describe("impactJson", () => {
  it("responde { data } sin caché", async () => {
    const response = impactJson({ allowed: true });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ data: { allowed: true } });
  });
});
