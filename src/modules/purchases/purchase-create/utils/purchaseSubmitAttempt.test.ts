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
});
