import { Badge } from "lucide-react";

import { SaleDetailPartyCard } from "./SaleDetailPartyCard";
import type { SaleSellerInfo } from "../utils/resolveSeller";

type SaleDetailSellerCardProps = {
  seller: SaleSellerInfo;
};

export function SaleDetailSellerCard({ seller }: SaleDetailSellerCardProps) {
  return (
    <SaleDetailPartyCard
      icon={Badge}
      name={seller.name}
      subtitle={seller.subtitle}
      title="Vendedor"
    />
  );
}
