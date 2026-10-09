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

/** INV-F2 · F1: reglas de la opcion `renewOnContentChange`. */
describe("RequestAttempt · renewOnContentChange (INV-F2)", () => {
  const networkError = new TypeError("Failed to fetch");
  const uncertainErrors: Array<[string, unknown]> = [
    ["error de red", networkError],
    ["5xx", new ClientApiError(500, "INTERNAL_ERROR", "boom")],
    ["408", new ClientApiError(408, "TIMEOUT", "tiempo agotado")],
    ["409", new ClientApiError(409, "CONFLICT", "clave ya usada")],
    ["4xx definitivo", new ClientApiError(400, "BAD_REQUEST", "Dato invalido")],
  ];

  it.each(uncertainErrors)(
    "regla 1 · tras %s, reintentar exactamente el mismo contenido conserva la clave",
    (_name, error) => {
      const attempt = new RequestAttempt({ renewOnContentChange: true });
      const key = attempt.begin(content);

      attempt.fail(error);

      expect(attempt.begin({ ...content })).toBe(key);
    },
  );

  it.each(uncertainErrors)(
    "regla 2 · tras %s, un contenido distinto estrena clave",
    (_name, error) => {
      const attempt = new RequestAttempt({ renewOnContentChange: true });
      const key = attempt.begin(content);

      attempt.fail(error);

      const nextKey = attempt.begin(otherContent);

      expect(nextKey).toEqual(expect.any(String));
      expect(nextKey).not.toBe(key);
    },
  );

  it("regla 2 · una clave nunca viaja con un contenido distinto del que estreno", () => {
    const attempt = new RequestAttempt({ renewOnContentChange: true });
    const key = attempt.begin(content);

    attempt.fail(networkError);
    const otherKey = attempt.begin(otherContent);
    attempt.fail(networkError);

    // Volver al contenido original tampoco recupera la primera clave.
    const backKey = attempt.begin(content);

    expect(new Set([key, otherKey, backKey]).size).toBe(3);
  });

  it("regla 3 · discard descarta el intento: el mismo contenido estrena clave", () => {
    const attempt = new RequestAttempt({ renewOnContentChange: true });
    const key = attempt.begin(content);

    attempt.fail(networkError);
    attempt.discard();

    expect(attempt.begin(content)).not.toBe(key);
  });

  it("sigue sin entregar clave con un envio en vuelo y renueva tras el exito", () => {
    const attempt = new RequestAttempt({ renewOnContentChange: true });
    const key = attempt.begin(content);

    expect(attempt.begin(otherContent)).toBeNull();

    attempt.succeed();

    expect(attempt.begin(content)).not.toBe(key);
  });
});
