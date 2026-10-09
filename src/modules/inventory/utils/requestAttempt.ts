import { useEffect, useState } from "react";

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

export type RequestAttemptOptions = {
  /**
   * La clave queda atada al contenido que la estrenó: cualquier envío con otro
   * contenido estrena clave, sea cual sea el error anterior. Sin la opción, la
   * clave solo se renueva al cambiar el contenido tras un 4xx definitivo.
   */
  renewOnContentChange?: boolean;
  /**
   * Tras el éxito el intento queda CERRADO: `begin` devuelve `null` hasta
   * `reopen()`. Para formularios que siguen montados después de confirmar (la
   * página navega al detalle, el modal aún no terminó de cerrarse): sin la
   * opción, `succeed()` soltaba el intento y un clic en esa ventana salía con
   * una clave nueva, es decir, otra operación.
   */
  lockAfterSuccess?: boolean;
};

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
 *
 * Con `renewOnContentChange` (ajuste y conversión de empaque) las reglas son:
 *
 * 1. La misma clave viaja SOLO para reintentar exactamente el mismo contenido
 *    (misma huella) tras un error de resultado incierto o un 409. Es lo que
 *    protege del duplicado.
 * 2. Si el contenido cambia respecto al último envío, tras cualquier error
 *    (incierto, 409 o 4xx definitivo), se estrena clave. Una clave nunca viaja
 *    con un contenido distinto del que estrenó: el servidor respondería el
 *    resultado del otro contenido como si fuera éxito, o un 409 sin salida.
 * 3. Cerrar el modal o desmontar el formulario descarta el intento (`discard`):
 *    al reabrir se estrena clave y no se arrastra el error anterior.
 * 4. Por las reglas 2 y 3 el intento anterior de resultado incierto pudo
 *    haberse registrado: el formulario lo avisa con `describeStockRequestError`
 *    (`stockRequestError.ts`) en vez del mensaje del navegador.
 *
 * Con `lockAfterSuccess` (INT-02): tras `succeed()` ningún `begin` entrega
 * clave hasta `reopen()`, que es lo que hace el formulario cuando se cierra o
 * cuando empieza a propósito otra operación («Guardar y crear otro»).
 * `discard()` olvida la clave pero NO reabre.
 */
export class RequestAttempt {
  private clientRequestId: string | null = null;
  private inFlight = false;
  private rejectedFingerprint: string | null = null;
  private sentFingerprint: string | null = null;
  private succeeded = false;
  private readonly lockAfterSuccess: boolean;
  private readonly renewOnContentChange: boolean;

  constructor({
    lockAfterSuccess = false,
    renewOnContentChange = false,
  }: RequestAttemptOptions = {}) {
    this.lockAfterSuccess = lockAfterSuccess;
    this.renewOnContentChange = renewOnContentChange;
  }

  begin(content: unknown): string | null {
    if (this.inFlight || this.succeeded) {
      return null;
    }

    const fingerprint = JSON.stringify(content);
    // Huella que, si difiere de la nueva, obliga a estrenar clave.
    const boundFingerprint = this.renewOnContentChange
      ? this.sentFingerprint
      : this.rejectedFingerprint;

    if (boundFingerprint !== null && boundFingerprint !== fingerprint) {
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
    this.discard();
    this.succeeded = this.lockAfterSuccess;
  }

  fail(error: unknown) {
    this.inFlight = false;
    this.rejectedFingerprint = isDefinitiveRejection(error) ? this.sentFingerprint : null;
  }

  /**
   * Olvida la clave y el contenido del intento (regla 3): el siguiente `begin`
   * estrena clave. No libera un envío en vuelo; eso lo hacen `succeed` y `fail`.
   */
  discard() {
    this.clientRequestId = null;
    this.rejectedFingerprint = null;
    this.sentFingerprint = null;
  }

  /**
   * El formulario se cerró o empieza otra operación: descarta el intento y, con
   * `lockAfterSuccess`, vuelve a aceptar envíos. No libera un envío en vuelo.
   */
  reopen() {
    this.succeeded = false;
    this.discard();
  }
}

/**
 * Reabre el intento cuando el formulario deja de estar abierto, se cierre como se
 * cierre (botón, Escape, tras el éxito o porque lo cierra quien lo controla). Con
 * `lockAfterSuccess`: desde el éxito hasta ese momento no se puede enviar.
 */
export function useReleaseAttemptOnClose(attempt: RequestAttempt, open: boolean) {
  useEffect(() => {
    if (!open) {
      attempt.reopen();
    }
  }, [attempt, open]);
}

/** Un `RequestAttempt` por instancia de formulario/dialogo. */
export function useRequestAttempt(options?: RequestAttemptOptions) {
  const [attempt] = useState(() => new RequestAttempt(options));

  return attempt;
}
