import { RequestAttempt } from "@/modules/inventory/utils/requestAttempt";

/**
 * Cerrojo y clave de idempotencia de «Confirmar Compra» (COM-F8 · 7a), sobre `RequestAttempt`.
 *
 * - En vuelo: `begin` devuelve `null` (doble clic, Enter o Espacio sobre el botón).
 * - Confirmada: `begin` devuelve `null` PARA SIEMPRE. La página sigue montada hasta que
 *   termina la navegación al detalle; `RequestAttempt` solo, al confirmar, soltaba el
 *   intento y el siguiente clic salía con una clave nueva: otra compra.
 * - Tras un fallo, el mismo contenido reintenta con la misma clave (el servidor no
 *   duplica si el primer envío sí llegó); si el contenido cambió, la clave es nueva,
 *   también tras un error de red o un 5xx.
 */
// unificar con renewOnContentChange (D33) en la integración
export class PurchaseSubmitAttempt {
  private attempt = new RequestAttempt();
  private confirmed = false;
  private failedFingerprint: string | null = null;
  private sentFingerprint: string | null = null;

  /** La clave a enviar, o `null` si no hay que enviar nada (en vuelo o ya confirmada). */
  begin(content: unknown): string | null {
    if (this.confirmed) {
      return null;
    }

    const fingerprint = JSON.stringify(content);

    // Solo hay huella fallida entre un fallo y el siguiente envío: nunca con uno en vuelo.
    if (this.failedFingerprint !== null && this.failedFingerprint !== fingerprint) {
      this.attempt = new RequestAttempt();
    }

    const clientRequestId = this.attempt.begin(content);

    if (clientRequestId !== null) {
      this.failedFingerprint = null;
      this.sentFingerprint = fingerprint;
    }

    return clientRequestId;
  }

  /** El servidor creó la compra: desde aquí ningún `begin` devuelve clave. */
  succeed() {
    this.confirmed = true;
    this.attempt.succeed();
  }

  fail(error: unknown) {
    this.attempt.fail(error);
    this.failedFingerprint = this.sentFingerprint;
  }
}
