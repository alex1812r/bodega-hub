import { AlertTriangle } from "lucide-react";

import { PRODUCT_IMPORT_MAX_ROWS } from "../../schemas/productImportRowSchema";

export function ProductImportLimitCallout() {
  return (
    <div className="product-import-callout">
      <AlertTriangle aria-hidden className="product-import-callout__icon size-5" />
      <div>
        <h4 className="product-import-callout__title">Límite de procesamiento</h4>
        <p className="product-import-callout__text">
          Por razones de rendimiento, el archivo no debe superar las{" "}
          <strong>{PRODUCT_IMPORT_MAX_ROWS} filas</strong> por carga. Si tu inventario
          es mayor, divide los datos en múltiples archivos.
        </p>
      </div>
    </div>
  );
}
