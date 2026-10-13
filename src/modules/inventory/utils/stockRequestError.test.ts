import { ClientApiError } from "@/shared/api/apiFetch";

import { describeStockRequestError, UNCERTAIN_STOCK_REQUEST_MESSAGE } from "./stockRequestError";

describe("describeStockRequestError (INV-F2 · regla 4)", () => {
  it("el texto del resultado incierto es el acordado, en español", () => {
    expect(UNCERTAIN_STOCK_REQUEST_MESSAGE).toBe(
      "No pudimos confirmar si el movimiento se registró. Revisa los movimientos del producto antes de volver a intentarlo.",
    );
  });

  it.each([
    ["error de red del navegador", new TypeError("Failed to fetch")],
    ["peticion abortada", new DOMException("The operation was aborted.", "AbortError")],
    ["500", new ClientApiError(500, "INTERNAL_ERROR", "Internal Server Error")],
    ["503", new ClientApiError(503, "UNKNOWN_ERROR", "No se pudo completar la solicitud.")],
    ["408", new ClientApiError(408, "TIMEOUT", "Request Timeout")],
  ])("%s: resultado incierto, nunca el mensaje del navegador", (_name, error) => {
    expect(describeStockRequestError(error)).toBe(UNCERTAIN_STOCK_REQUEST_MESSAGE);
  });

  it.each([400, 403, 404, 409, 422])(
    "%i: el mensaje del servidor se muestra tal cual",
    (status) => {
      const error = new ClientApiError(status, "ERROR", "Stock insuficiente de empaque.");

      expect(describeStockRequestError(error)).toBe("Stock insuficiente de empaque.");
    },
  );
});
