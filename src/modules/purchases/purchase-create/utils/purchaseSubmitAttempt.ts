import { RequestAttempt } from "@/modules/inventory/utils/requestAttempt";

/**
 * Cerrojo y clave de idempotencia de «Confirmar Compra» (COM-F8 · 7a): un
 * `RequestAttempt` con `renewOnContentChange` (D33) y `lockAfterSuccess`.
 *
 * - En vuelo: `begin` devuelve `null` (doble clic, Enter o Espacio sobre el botón).
 * - Confirmada: `begin` devuelve `null` PARA SIEMPRE. La página sigue montada hasta que
 *   termina la navegación al detalle; sin el cerrojo, el siguiente clic salía con una
 *   clave nueva: otra compra. Nadie llama a `reopen`: esta pantalla crea UNA compra.
 * - Tras un fallo, el mismo contenido reintenta con la misma clave (el servidor no
 *   duplica si el primer envío sí llegó); si el contenido cambió, la clave es nueva,
 *   también tras un error de red, un 5xx o un 409: una clave nunca viaja con un
 *   contenido distinto del que estrenó.
 */
export class PurchaseSubmitAttempt {
  private readonly attempt = new RequestAttempt({
    lockAfterSuccess: true,
    renewOnContentChange: true,
  });

  /** La clave a enviar, o `null` si no hay que enviar nada (en vuelo o ya confirmada). */
  begin(content: unknown): string | null {
    return this.attempt.begin(content);
  }

  /** El servidor creó la compra: desde aquí ningún `begin` devuelve clave. */
  succeed() {
    this.attempt.succeed();
  }

  fail(error: unknown) {
    this.attempt.fail(error);
  }

  /**
   * El formulario pasa a ser OTRA compra (borrador restaurado, reposición que
   * reemplaza a la compra en curso): se olvida la clave del intento anterior. No
   * reabre una compra ya confirmada ni libera un envío en vuelo.
   */
  discard() {
    this.attempt.discard();
  }
}
