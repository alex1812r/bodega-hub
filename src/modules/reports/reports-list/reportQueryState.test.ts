import { ClientApiError } from "@/shared/api/apiFetch";

import {
  getReportQueryError,
  REPORT_GENERIC_ERROR_MESSAGE,
  REPORT_OFFLINE_MESSAGE,
  ReportOfflineError,
  toReportErrorMessage,
} from "./reportQueryState";

const INTERNAL = 'relation "public.sales" does not exist';

/**
 * REP-F10 (N-10): un 5xx llega como `ClientApiError` con el mensaje interno del
 * servidor ("URI too long", el de Postgres…). Solo un 4xx es un error de
 * negocio con texto para el usuario.
 */
describe("toReportErrorMessage", () => {
  it("un 4xx de negocio enseña su mensaje", () => {
    expect(toReportErrorMessage(new ClientApiError(400, "BAD_REQUEST", 'La fecha "desde" no es válida.'))).toBe(
      'La fecha "desde" no es válida.',
    );
  });

  it.each([500, 502, 503, 504])("un %i del servidor sale con el texto genérico, no con su mensaje", (status) => {
    expect(toReportErrorMessage(new ClientApiError(status, "UNKNOWN_ERROR", INTERNAL))).toBe(
      REPORT_GENERIC_ERROR_MESSAGE,
    );
    expect(toReportErrorMessage(new ClientApiError(status, "UNKNOWN_ERROR", INTERNAL), "No pudimos cargar X.")).toBe(
      "No pudimos cargar X.",
    );
  });

  it("cualquier otro error sale con el texto genérico y sin red, con su aviso", () => {
    expect(toReportErrorMessage(new Error("Failed to fetch"))).toBe(REPORT_GENERIC_ERROR_MESSAGE);
    expect(toReportErrorMessage(new ReportOfflineError())).toBe(REPORT_OFFLINE_MESSAGE);
  });
});

describe("getReportQueryError", () => {
  it("conserva el error de negocio (el 403 incluido)", () => {
    const forbidden = new ClientApiError(403, "FORBIDDEN", "Sin permiso.");

    expect(getReportQueryError({ error: forbidden })).toBe(forbidden);
  });

  it("un 5xx se sustituye por el error genérico: su mensaje no llega a la pantalla", () => {
    const error = getReportQueryError({ error: new ClientApiError(500, "UNKNOWN_ERROR", INTERNAL) });

    expect(error).not.toBeInstanceOf(ClientApiError);
    expect(error?.message).toBe(REPORT_GENERIC_ERROR_MESSAGE);
  });

  it("una respuesta 200 con `data: null` es un error, no un reporte en blanco ni una carga eterna", () => {
    expect(getReportQueryError({ data: null })?.message).toBe(REPORT_GENERIC_ERROR_MESSAGE);
  });

  it("sin datos todavía no hay error; en pausa por falta de red, el aviso de conexión", () => {
    expect(getReportQueryError({ data: undefined })).toBeNull();
    expect(getReportQueryError({ data: { items: [] } })).toBeNull();
    expect(getReportQueryError({ isPaused: true })).toBeInstanceOf(ReportOfflineError);
  });
});
