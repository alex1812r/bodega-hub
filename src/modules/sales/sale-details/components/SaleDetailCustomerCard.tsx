import { User } from "lucide-react";

import type { ContactMock } from "@/shared/mocks/erp-data";

import { SaleDetailPartyCard } from "./SaleDetailPartyCard";

type SaleDetailCustomerCardProps = {
  customer?: ContactMock;
  customerId: string;
};

export function SaleDetailCustomerCard({
  customer,
  customerId,
}: SaleDetailCustomerCardProps) {
  return (
    <SaleDetailPartyCard
      icon={User}
      name={customer?.name ?? customerId}
      subtitle={customer?.taxId}
      title="Cliente"
    />
  );
}
