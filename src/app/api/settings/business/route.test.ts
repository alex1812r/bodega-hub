/**
 * @jest-environment node
 */

jest.mock("../../../../lib/supabase/route-client");

import { GET } from "./route";

function request(role: string) {
  return new Request("http://localhost/api/settings/business", {
    headers: { "x-demo-role": role },
  });
}

// GQ-03: el detalle de venta y «Mis recibos» solo necesitan el nombre del negocio
// (recibo y PDF). Quien los abre sin `settings.view` no debe recibir un 403.
describe("/api/settings/business", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  it.each(["vendedor", "contador", "admin"])(
    "gives %s the business name and nothing else",
    async (role) => {
      const response = await GET(request(role));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data).toEqual({ businessName: expect.any(String) });
      expect(body.data.businessName.length).toBeGreaterThan(0);
    },
  );

  it("rejects a role with none of the screens that print the business name", async () => {
    const response = await GET(request("almacen"));

    expect(response.status).toBe(403);
  });

  it("rejects the superadmin, who has no store", async () => {
    const response = await GET(request("superadmin"));

    expect(response.status).toBe(403);
  });
});
