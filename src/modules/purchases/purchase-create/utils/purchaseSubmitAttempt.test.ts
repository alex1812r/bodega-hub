import { ClientApiError } from "@/shared/api/apiFetch";

import { PurchaseSubmitAttempt } from "./purchaseSubmitAttempt";

const content = { items: [{ productId: "prod-1", quantity: 1 }], supplierId: "cont-1" };
const changed = { items: [{ productId: "prod-1", quantity: 2 }], supplierId: "cont-1" };

describe("PurchaseSubmitAttempt", () => {
  it("con un envío en vuelo no da otra clave", () => {
    const attempt = new PurchaseSubmitAttempt();

    expect(attempt.begin(content)).toMatch(/^[0-9a-f-]{36}$/);
    expect(attempt.begin(content)).toBeNull();
    expect(attempt.begin(changed)).toBeNull();
  });

  it("una vez confirmada la compra no vuelve a dar clave, ni con otro contenido", () => {
    const attempt = new PurchaseSubmitAttempt();

    attempt.begin(content);
    attempt.succeed();

    expect(attempt.begin(content)).toBeNull();
    expect(attempt.begin(changed)).toBeNull();
  });

  it("tras un error de red, el mismo contenido reintenta con la misma clave las veces que haga falta", () => {
    const attempt = new PurchaseSubmitAttempt();
    const first = attempt.begin(content);

    attempt.fail(new TypeError("Failed to fetch"));
    expect(attempt.begin(content)).toBe(first);
    attempt.fail(new TypeError("Failed to fetch"));
    expect(attempt.begin(content)).toBe(first);
  });

  it("tras un error de red, si el contenido cambió la clave es nueva", () => {
    const attempt = new PurchaseSubmitAttempt();
    const first = attempt.begin(content);

    attempt.fail(new TypeError("Failed to fetch"));

    const second = attempt.begin(changed);

    expect(second).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).not.toBe(first);
  });

  it("tras un rechazo definitivo (422), el contenido corregido sale con clave nueva", () => {
    const attempt = new PurchaseSubmitAttempt();
    const first = attempt.begin(content);

    attempt.fail(new ClientApiError(422, "PT422", "Dato inválido"));

    expect(attempt.begin(changed)).not.toBe(first);
  });

  it("un clic durante el envío con el contenido ya cambiado no altera la clave del reintento", () => {
    const attempt = new PurchaseSubmitAttempt();
    const first = attempt.begin(content);

    expect(attempt.begin(changed)).toBeNull();
    attempt.fail(new TypeError("Failed to fetch"));

    // Lo que falló fue `content`: reintentarlo igual conserva su clave.
    expect(attempt.begin(content)).toBe(first);
  });

  // INT-02 · D33: sobre RequestAttempt({ renewOnContentChange, lockAfterSuccess }).
  it("tras un 409, el contenido cambiado sale con clave nueva y el mismo contenido la conserva", () => {
    const attempt = new PurchaseSubmitAttempt();
    const first = attempt.begin(content);

    attempt.fail(new ClientApiError(409, "CONFLICT", "Conflicto"));
    expect(attempt.begin(content)).toBe(first);
    attempt.fail(new ClientApiError(409, "CONFLICT", "Conflicto"));

    const second = attempt.begin(changed);

    expect(second).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).not.toBe(first);
  });

  it("misma clave ×8: ocho reintentos del mismo contenido tras fallos inciertos viajan con UNA clave", () => {
    const attempt = new PurchaseSubmitAttempt();
    const keys = new Set<string | null>();

    for (let retry = 0; retry < 8; retry += 1) {
      keys.add(attempt.begin(content));
      attempt.fail(new TypeError("Failed to fetch"));
    }

    expect(keys.size).toBe(1);
    expect([...keys][0]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("discard olvida la clave de un intento fallido (otra compra), pero no reabre una compra confirmada ni libera un envío en vuelo", () => {
    const failed = new PurchaseSubmitAttempt();
    const first = failed.begin(content);

    failed.fail(new TypeError("Failed to fetch"));
    failed.discard();
    expect(failed.begin(content)).not.toBe(first);

    const inFlight = new PurchaseSubmitAttempt();

    inFlight.begin(content);
    inFlight.discard();
    expect(inFlight.begin(content)).toBeNull();

    const confirmed = new PurchaseSubmitAttempt();

    confirmed.begin(content);
    confirmed.succeed();
    confirmed.discard();
    expect(confirmed.begin(content)).toBeNull();
    expect(confirmed.begin(changed)).toBeNull();
  });
});
