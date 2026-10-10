/**
 * Lo único de la configuración de la tienda que necesitan el recibo de venta y
 * el recibo de nómina: el nombre del negocio (`GET /api/settings/business`).
 * `null` si la tienda aún no tiene configuración: quien lo use cae a su nombre
 * por defecto.
 */
export type BusinessSettings = { businessName: string | null };
