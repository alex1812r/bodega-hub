/**
 * @jest-environment node
 */

import { POST } from "../../route";
import { GET } from "./route";

const context = (clientRequestId: string) => ({
  params: Promise.resolve({ clientRequestId }),
});

function getByRequest(clientRequestId: string, headers: Record<string, string>) {
  return GET(
    new Request(`http://localhost/api/sales/by-request/${clientRequestId}`, { headers }),
    context(clientRequestId),
  );
}

async function createSale(clientRequestId: string, headers: Record<string, string>) {
  const response = await POST(
    new Request("http://localhost/api/sales", {
      body: JSON.stringify({
        clientRequestId,
        customerId: "cont-customer",
        items: [{ productId: "prod-drill", quantity: 2 }],
      }),
      headers: { "content-type": "application/json", ...headers },
      method: "POST",
    }),
  );

  return (await response.json()).data as { id: string; invoiceNumber: string };
}

describe("/api/sales/by-request/[clientRequestId]", () => {
  const seller = { "x-demo-role": "vendedor" };

  it("returns the sale registered with that key in the sale-detail shape", async () => {
    const clientRequestId = "3d4e5f6a-7b8c-4d9e-8f0a-1b2c3d4e5f6a";
    const created = await createSale(clientRequestId, seller);

    const response = await getByRequest(clientRequestId, seller);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual(
      expect.objectContaining({
        id: created.id,
        invoiceNumber: created.invoiceNumber,
        items: [expect.objectContaining({ productId: "prod-drill", quantity: 2 })],
        payments: expect.any(Array),
      }),
    );
  });

  it("returns not found when no sale was registered with that key", async () => {
    const response = await getByRequest("4e5f6a7b-8c9d-4e0f-9a1b-2c3d4e5f6a7b", seller);

    expect(response.status).toBe(404);
  });

  it("hides the sale of another seller but shows it to an admin", async () => {
    const clientRequestId = "5f6a7b8c-9d0e-4f1a-8b2c-3d4e5f6a7b8c";
    const created = await createSale(clientRequestId, seller);

    // Otro vendedor real del catalogo demo (un id desconocido cae al usuario por rol).
    const otherSeller = await getByRequest(clientRequestId, {
      "x-demo-role": "vendedor",
      "x-demo-user-id": "user-seller",
    });
    const admin = await getByRequest(clientRequestId, { "x-demo-role": "admin" });

    expect(otherSeller.status).toBe(404);
    expect(admin.status).toBe(200);
    expect((await admin.json()).data.id).toBe(created.id);
  });

  it("does not cross stores", async () => {
    const clientRequestId = "6a7b8c9d-0e1f-4a2b-9c3d-4e5f6a7b8c9d";
    await createSale(clientRequestId, seller);

    const response = await getByRequest(clientRequestId, {
      "x-demo-role": "admin",
      "x-demo-store-id": "store-otra",
    });

    expect(response.status).toBe(404);
  });

  it("rejects a key that is not a uuid", async () => {
    const response = await getByRequest("no-es-uuid", seller);

    expect(response.status).toBe(400);
  });

  it("blocks roles without sales.view", async () => {
    const response = await getByRequest("7b8c9d0e-1f2a-4b3c-8d4e-5f6a7b8c9d0e", {
      "x-demo-role": "almacen",
    });

    expect(response.status).toBe(403);
  });
});
