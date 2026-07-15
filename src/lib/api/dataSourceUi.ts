import type { ApiDataSource } from "./dataSource";

/**
 * Fuente de datos para copy de UI en el cliente.
 * Debe coincidir con API_DATA_SOURCE del servidor (ver NEXT_PUBLIC_API_DATA_SOURCE en .env).
 */
export function resolveClientDataSource(): ApiDataSource {
  const configured = process.env.NEXT_PUBLIC_API_DATA_SOURCE;

  if (configured === "mock" || configured === "supabase") {
    return configured;
  }

  return "supabase";
}

export function isMockDataSource() {
  return resolveClientDataSource() === "mock";
}

export function isDemoAuthEnabledUi() {
  return process.env.NEXT_PUBLIC_ALLOW_DEMO_AUTH === "true";
}

/** UI de desarrollo: auth demo, copy mock o herramientas /dev. */
export function isDevToolkitEnabledUi() {
  return (
    process.env.NODE_ENV === "development" ||
    isDemoAuthEnabledUi() ||
    isMockDataSource()
  );
}

export function getApiLayerName() {
  return isMockDataSource() ? "API mock" : "Supabase";
}

export function getConnectedToLayerPhrase() {
  return isMockDataSource() ? "conectado a la capa API mock" : "";
}

export function getConnectedToApiPhrase() {
  return isMockDataSource() ? "conectado a la API mock" : "";
}

/** Sufijo opcional para descripciones de pagina (solo en modo mock). */
export function getPageDataSourceSuffix() {
  const phrase = getConnectedToApiPhrase();

  return phrase ? ` ${phrase}.` : ".";
}

export function getFormSaveDescription() {
  return isMockDataSource()
    ? "Los cambios se envian a la API mock y luego invalidan las consultas del modulo."
    : "Confirma los datos antes de guardar.";
}

export function getSettingsSavedMessage() {
  return isMockDataSource() ? "Ajustes guardados en el mock." : "Ajustes guardados.";
}

export function getExchangeRateSavedMessage() {
  return isMockDataSource()
    ? "Tasa registrada para esta sesion mock."
    : "Tasa registrada correctamente.";
}

export function getPriceChangeReason() {
  return isMockDataSource()
    ? "Cambio registrado por API mock"
    : "Cambio de precio registrado";
}
