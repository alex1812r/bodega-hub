import Link from "next/link";

import { withChainedReturnTo } from "@/modules/inventory/utils/chainedReturnTo";
import type { ContactMock } from "@/shared/mocks/erp-data";

type PurchaseDetailSupplierCardProps = {
  /**
   * URL actual del detalle (ruta + query, con el `returnTo` con el que se llegó):
   * viaja en el enlace al proveedor para que "Volver" regrese a esta compra y la
   * compra siga sabiendo volver a su lista.
   */
  detailUrl: string;
  supplier?: ContactMock;
  supplierId: string;
};

/** Contenido de la sección «Proveedor»: nombre (enlace a su ficha) y RIF. */
export function PurchaseDetailSupplierCard({
  detailUrl,
  supplier,
  supplierId,
}: PurchaseDetailSupplierCardProps) {
  const name = supplier?.name ?? supplierId;
  const taxId = supplier?.taxId;

  return (
    <div>
      {supplier ? (
        <Link
          className="text-base font-semibold text-foreground transition-colors hover:text-primary"
          href={withChainedReturnTo(`/contacts/${supplier.id}`, detailUrl)}
        >
          {name}
        </Link>
      ) : (
        <p className="text-base font-semibold text-foreground">{name}</p>
      )}
      {taxId ? <p className="mt-1 text-sm text-on-surface-variant">RIF: {taxId}</p> : null}
    </div>
  );
}
