/** Excel admite 32.767 caracteres por celda; se deja margen. */
export const EXCEL_CELL_MAX_LENGTH = 32_000;

/**
 * Recorta un texto que no cabe en una celda de Excel y lo marca con "…". Los
 * valores que no son texto pasan tal cual. Defensa para datos históricos: los
 * motivos nuevos ya tienen tope en el servidor.
 */
export function fitExcelCell<T>(value: T): T | string {
  return typeof value === "string" && value.length > EXCEL_CELL_MAX_LENGTH
    ? `${value.slice(0, EXCEL_CELL_MAX_LENGTH - 1)}…`
    : value;
}
