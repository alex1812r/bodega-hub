import { Badge } from "@/shared/components/Badge";
import { DetailSection } from "@/shared/components/DetailSection";
import { InfoGrid } from "@/shared/components/InfoGrid";

export type ContactProfile = {
  address: string;
  email: string;
  name: string;
  phone: string;
  taxId: string;
  type: "cliente" | "proveedor" | "ambos";
};

type ContactProfileCardProps = {
  contact: ContactProfile;
};

const typeVariant = {
  cliente: "info",
  proveedor: "warning",
  ambos: "success",
} as const;

export function ContactProfileCard({ contact }: ContactProfileCardProps) {
  return (
    <DetailSection
      description="Datos principales para ventas, compras y pagos."
      title={contact.name}
    >
      <InfoGrid
        items={[
          {
            label: "Tipo",
            value: <Badge variant={typeVariant[contact.type]}>{contact.type}</Badge>,
          },
          { label: "Telefono", value: contact.phone },
          { label: "Correo", value: contact.email },
          { label: "Documento", value: contact.taxId },
          { label: "Direccion", value: contact.address },
        ]}
        columns={3}
      />
    </DetailSection>
  );
}
