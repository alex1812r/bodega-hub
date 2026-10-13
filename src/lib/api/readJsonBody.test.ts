/**
 * @jest-environment node
 */

import { ApiError } from "@/lib/api/apiError";

import { readJsonBody, readOptionalJsonBody } from "./readJsonBody";

const INVALID_JSON_MESSAGE = "El cuerpo de la solicitud no es un JSON válido.";

function request(body?: string) {
  return new Request("http://localhost/api/x", {
    body,
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("Se esperaba un rechazo.");
}

function expectInvalidJson(error: unknown) {
  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({ code: "BAD_REQUEST", message: INVALID_JSON_MESSAGE, status: 400 });
}

describe("readJsonBody", () => {
  it("devuelve el JSON del cuerpo", async () => {
    await expect(readJsonBody(request('{"a":1}'))).resolves.toEqual({ a: 1 });
  });

  it.each([
    ["malformado", "{roto"],
    ["vacío", undefined],
    ["solo espacios", "   "],
  ])("un cuerpo %s es un 400 con el mensaje con tildes", async (_name, body) => {
    expectInvalidJson(await rejection(readJsonBody(request(body))));
  });

  it("no disfraza de 400 un fallo que no es de sintaxis", async () => {
    const consumed = request('{"a":1}');
    await consumed.text();

    const error = await rejection(readJsonBody(consumed));

    expect(error).not.toBeInstanceOf(ApiError);
  });
});

describe("readOptionalJsonBody", () => {
  it("devuelve el JSON del cuerpo", async () => {
    await expect(readOptionalJsonBody(request('{"a":1}'))).resolves.toEqual({ a: 1 });
  });

  it.each([
    ["sin cuerpo", undefined],
    ["cuerpo vacío", ""],
    ["solo espacios", " \n\t "],
  ])("%s vale un objeto vacío", async (_name, body) => {
    await expect(readOptionalJsonBody(request(body))).resolves.toEqual({});
  });

  it("un cuerpo malformado es un 400 con el mensaje con tildes", async () => {
    expectInvalidJson(await rejection(readOptionalJsonBody(request("{roto"))));
  });
});
