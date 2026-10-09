import { renderHook } from "@testing-library/react";

import { ClientApiError } from "@/shared/api/apiFetch";

import { RequestAttempt, useReleaseAttemptOnClose } from "./requestAttempt";

/**
 * INT-02 · B3 — `lockAfterSuccess`: tras el éxito, un formulario que sigue
 * montado (navega, o su modal aún no se cerró) no debe poder enviar otra vez.
 * Sin la opción, `succeed()` soltaba el intento y el siguiente clic salía con
 * una clave nueva: una operación duplicada que la idempotencia no detecta.
 */

const content = { productId: "prod-1", quantity: 1 };
const changed = { productId: "prod-1", quantity: 2 };
const KEY = /^[0-9a-f-]{36}$/;

describe("RequestAttempt · lockAfterSuccess", () => {
  it("tras el éxito no entrega clave, ni con el mismo contenido ni con otro", () => {
    const attempt = new RequestAttempt({ lockAfterSuccess: true });

    expect(attempt.begin(content)).toMatch(KEY);
    attempt.succeed();

    expect(attempt.begin(content)).toBeNull();
    expect(attempt.begin(changed)).toBeNull();
  });

  it("discard no lo libera (olvida la clave, no el éxito); reopen sí, y estrena clave", () => {
    const attempt = new RequestAttempt({ lockAfterSuccess: true, renewOnContentChange: true });
    const first = attempt.begin(content);

    attempt.succeed();
    attempt.discard();
    expect(attempt.begin(content)).toBeNull();

    attempt.reopen();

    const second = attempt.begin(content);

    expect(second).toMatch(KEY);
    expect(second).not.toBe(first);
  });

  it("un fallo no bloquea: el reintento conserva la clave y otro contenido la renueva", () => {
    const attempt = new RequestAttempt({ lockAfterSuccess: true, renewOnContentChange: true });
    const first = attempt.begin(content);

    attempt.fail(new TypeError("Failed to fetch"));
    expect(attempt.begin(content)).toBe(first);
    attempt.fail(new ClientApiError(409, "CONFLICT", "Conflicto"));
    expect(attempt.begin(changed)).not.toBe(first);
  });

  it("sin la opción el comportamiento es el de siempre: tras el éxito, clave nueva", () => {
    const attempt = new RequestAttempt();
    const first = attempt.begin(content);

    attempt.succeed();

    expect(attempt.begin(content)).not.toBe(first);
  });

  it("reopen no libera un envío en vuelo", () => {
    const attempt = new RequestAttempt({ lockAfterSuccess: true });

    attempt.begin(content);
    attempt.reopen();

    expect(attempt.begin(content)).toBeNull();
  });
});

describe("useReleaseAttemptOnClose", () => {
  it("libera el intento cuando el formulario se cierra, no mientras sigue abierto", () => {
    const attempt = new RequestAttempt({ lockAfterSuccess: true });
    const view = renderHook(({ open }) => useReleaseAttemptOnClose(attempt, open), {
      initialProps: { open: true },
    });

    attempt.begin(content);
    attempt.succeed();
    view.rerender({ open: true });
    expect(attempt.begin(content)).toBeNull();

    view.rerender({ open: false });
    expect(attempt.begin(content)).toMatch(KEY);
  });
});
