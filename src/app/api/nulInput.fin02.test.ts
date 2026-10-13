/**
 * @jest-environment node
 */
/**
 * FIN-02 · un carácter nulo (U+0000) en un texto libre o en el id de la URL
 * llegaba a Postgres, que no lo admite (22P05), y la ruta respondía 500. Es un
 * dato inválido del cliente: 400 con mensaje en español; el esquema o
 * el guard común lo rechazan antes de llamar al servicio.
 */

import { POST as createRegister } from "./cash/registers/route";
import { PATCH as updateContact } from "./contacts/[id]/route";
import { POST as createContact } from "./contacts/route";
import { POST as approvePeriod } from "./payroll/periods/[id]/approve/route";
import { PATCH as deactivateLink } from "./supplier-products/[id]/deactivate/route";

const NUL = "\u0000";
// Mensajes en español del BFF: el de validación de esquema y el de dato inválido.
const SPANISH = /^(La solicitud no tiene un formato válido.|Los datos enviados no son válidos.)$/;

function jsonRequest(path: string, method: string, body?: unknown) {
  return new Request(`http://localhost${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json", "x-demo-role": "admin" },
    method,
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function expectRejected(response: Response) {
  const body = await response.json();

  expect(response.status).toBe(400);
  expect(body.error.code).toBe("BAD_REQUEST");
  expect(body.error.message).toMatch(SPANISH);
}

describe("FIN-02: carácter nulo en texto libre o en el id de la URL → 400", () => {
  const originalDataSource = process.env.API_DATA_SOURCE;

  beforeEach(() => {
    process.env.API_DATA_SOURCE = "mock";
  });

  afterAll(() => {
    process.env.API_DATA_SOURCE = originalDataSource;
  });

  it("POST /api/contacts con NUL en el nombre", async () => {
    await expectRejected(await createContact(jsonRequest("/api/contacts", "POST", { name: `a${NUL}b`, type: "cliente" })));
  });

  it.each(["name", "address", "phone", "taxId"])("PATCH /api/contacts/[id] con NUL en %s", async (field) => {
    await expectRejected(
      await updateContact(
        jsonRequest("/api/contacts/cont-customer-alt", "PATCH", { [field]: `a${NUL}b` }),
        params("cont-customer-alt"),
      ),
    );
  });

  it("POST /api/cash/registers con NUL en el nombre", async () => {
    await expectRejected(await createRegister(jsonRequest("/api/cash/registers", "POST", { name: `a${NUL}b` })));
  });

  it("POST /api/payroll/periods/%00/approve", async () => {
    await expectRejected(await approvePeriod(jsonRequest("/api/payroll/periods/%00/approve", "POST"), params(NUL)));
  });

  it("PATCH /api/supplier-products/%00/deactivate", async () => {
    await expectRejected(
      await deactivateLink(jsonRequest("/api/supplier-products/%00/deactivate", "PATCH"), params(NUL)),
    );
  });
});
