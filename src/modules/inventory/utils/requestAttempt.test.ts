import { ClientApiError } from "@/shared/api/apiFetch";

import { RequestAttempt } from "./requestAttempt";

const content = { productId: "prod-cable", quantityDelta: 2 };
const otherContent = { productId: "prod-cable", quantityDelta: 3 };

describe("RequestAttempt", () => {
  it("no entrega clave mientras hay un envio en vuelo (doble clic)", () => {
    const attempt = new RequestAttempt();

    expect(attempt.begin(content)).toEqual(expect.any(String));
    expect(attempt.begin(content)).toBeNull();
  });

  it("conserva la clave tras un error de red o un 5xx, aunque cambie el contenido", () => {
    const attempt = new RequestAttempt();
    const key = attempt.begin(content);

    attempt.fail(new TypeError("Failed to fetch"));
    expect(attempt.begin(content)).toBe(key);

    attempt.fail(new ClientApiError(500, "INTERNAL_ERROR", "boom"));
    expect(attempt.begin(otherContent)).toBe(key);

    attempt.fail(new ClientApiError(409, "CONFLICT", "reintentable"));
    expect(attempt.begin(content)).toBe(key);
  });

  it("renueva la clave tras el exito confirmado por el servidor", () => {
    const attempt = new RequestAttempt();
    const key = attempt.begin(content);

    attempt.succeed();

    expect(attempt.begin(content)).not.toBe(key);
  });

  it("tras un 4xx definitivo renueva la clave solo si cambia el contenido", () => {
    const attempt = new RequestAttempt();
    const key = attempt.begin(content);

    attempt.fail(new ClientApiError(400, "BAD_REQUEST", "Stock insuficiente"));
    expect(attempt.begin(content)).toBe(key);

    attempt.fail(new ClientApiError(400, "BAD_REQUEST", "Stock insuficiente"));
    expect(attempt.begin(otherContent)).not.toBe(key);
  });
});
