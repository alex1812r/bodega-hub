import { useState } from "react";

import { ClientApiError } from "@/shared/api/apiFetch";

/**
 * El servidor respondio que NO hizo nada y repetir lo mismo no cambia el
 * resultado (400, 401, 403, 404, 422…). Quedan fuera, por ser de resultado
 * incierto: error de red, 5xx, 408 y 409.
 */
function isDefinitiveRejection(error: unknown) {
  return (
    error instanceof ClientApiError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 408 &&
    error.status !== 409
  );
}

/**
 * Clave de idempotencia de un formulario que mueve stock (compra, ajuste,
 * conversion). Una clave por intento:
 *
 * - `begin` devuelve la clave a enviar, o `null` si ya hay un envio en vuelo
 *   (doble clic antes de que React deshabilite el boton).
 * - Tras un error de resultado incierto (red, 5xx) la clave se conserva: el
 *   reintento manual viaja con la misma y el servidor no duplica.
 * - Se renueva cuando el servidor confirma el exito, o cuando el contenido
 *   cambia despues de un rechazo definitivo (4xx): ese intento no creo nada.
 */
export class RequestAttempt {
  private clientRequestId: string | null = null;
  private inFlight = false;
  private rejectedFingerprint: string | null = null;
  private sentFingerprint: string | null = null;

  begin(content: unknown): string | null {
    if (this.inFlight) {
      return null;
    }

    const fingerprint = JSON.stringify(content);

    if (this.rejectedFingerprint !== null && this.rejectedFingerprint !== fingerprint) {
      this.clientRequestId = null;
    }

    this.rejectedFingerprint = null;
    this.sentFingerprint = fingerprint;
    this.clientRequestId ??= crypto.randomUUID();
    this.inFlight = true;

    return this.clientRequestId;
  }

  succeed() {
    this.inFlight = false;
    this.clientRequestId = null;
    this.rejectedFingerprint = null;
    this.sentFingerprint = null;
  }

  fail(error: unknown) {
    this.inFlight = false;
    this.rejectedFingerprint = isDefinitiveRejection(error) ? this.sentFingerprint : null;
  }
}

/** Un `RequestAttempt` por instancia de formulario/dialogo. */
export function useRequestAttempt() {
  const [attempt] = useState(() => new RequestAttempt());

  return attempt;
}
