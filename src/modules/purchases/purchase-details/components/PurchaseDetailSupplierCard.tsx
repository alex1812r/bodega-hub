import { Truck } from "lucide-react";
import Link from "next/link";

import type { ContactMock } from "@/shared/mocks/erp-data";

import { PurchaseDetailInfoCard } from "./PurchaseDetailInfoCard";

type PurchaseDetailSupplierCardProps = {
  supplier?: ContactMock;
  supplierId: string;
};

export function PurchaseDetailSupplierCard({
  supplier,
  supplierId,
}: PurchaseDetailSupplierCardProps) {
  const name = supplier?.name ?? supplierId;
  const taxId = supplier?.taxId;

  return (
    <PurchaseDetailInfoCard icon={Truck} title="Proveedor">
      {supplier ? (
        <Link
          className="text-base font-semibold text-foreground transition-colors hover:text-primary"
          href={`/contacts/${supplier.id}`}
        >
          {name}
        </Link>
      ) : (
        <p className="text-base font-semibold text-foreground">{name}</p>
      )}
      {taxId ? (
        <p className="mt-1 text-sm text-on-surface-variant">RIF: {taxId}</p>
      ) : null}
    </PurchaseDetailInfoCard>
  );
}
