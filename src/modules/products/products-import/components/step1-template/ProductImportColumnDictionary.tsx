import { Info } from "lucide-react";

import { cn } from "@/shared/utils/cn";

import { ProductImportRequirementBadge } from "../shared/ProductImportRequirementBadge";
import { PRODUCT_IMPORT_COLUMN_DEFINITIONS } from "./productImportColumnDefinitions";

export function ProductImportColumnDictionary() {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="product-import-dict__title">Diccionario de Columnas</h3>
      <div className="product-import-dict__wrap">
        <table className="product-import-dict__table">
          <thead>
            <tr>
              <th>Columna (Header)</th>
              <th>Requisito</th>
              <th>Descripción</th>
            </tr>
          </thead>
          <tbody>
            {PRODUCT_IMPORT_COLUMN_DEFINITIONS.map((row) => (
              <tr
                className={cn(row.alternateRow && "product-import-dict__row--alt")}
                key={row.column}
              >
                <td
                  className={cn(
                    "product-import-dict__col-name",
                    row.required && "product-import-dict__col-name--primary",
                  )}
                >
                  {row.column}
                </td>
                <td>
                  <ProductImportRequirementBadge required={row.required} />
                </td>
                <td className="product-import-dict__col-desc">{row.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="product-import-dict__note">
        <Info aria-hidden className="size-3.5" />
        Nota: No modifiques la primera fila (encabezados) del archivo descargado.
      </p>
    </div>
  );
}
