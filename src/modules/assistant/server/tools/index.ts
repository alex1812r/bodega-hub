/**
 * Punto unico de carga de herramientas: importar este modulo las registra todas.
 * Cualquier consumidor debe usar `toolsForContext` desde aqui, nunca desde
 * `toolRegistry` directamente, o el registro llegaria vacio.
 */
import { listToolDefinitions, toolsForContext } from "../toolRegistry";

import "./capitalActual";
import "./cierreDia";
import "./compararTiendas";
import "./comprasPeriodo";
import "./gananciaBruta";
import "./listarTiendas";
import "./metodosPago";
import "./rentabilidadProductos";
import "./stockBajo";
import "./topClientes";
import "./topProductos";
import "./ventasPeriodo";

import type { AssistantToolScope } from "../../types";

export { listToolDefinitions, toolsForContext };

export function toolNamesForScope(scope: AssistantToolScope) {
  return listToolDefinitions()
    .filter((definition) => definition.scope === scope)
    .map((definition) => definition.name);
}
