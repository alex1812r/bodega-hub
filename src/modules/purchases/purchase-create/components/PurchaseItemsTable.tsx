"use client";

import { Button } from "@/shared/components/Button";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { DetailSection } from "@/shared/components/DetailSection";
import { Input } from "@/shared/components/Input";
import { SelectField } from "@/shared/components/SelectField";
import { formatRef, formatVes, refToVes } from "@/shared/utils/currency";

export type PurchaseDraftItem = {
  id: string;
  productId: string;
  quantity: number;
  unitCostRef: number;
};

type PurchaseProductOption = {
  label: string;
  lastCostRef?: number;
  value: string;
};

type PurchaseItemsTableProps = {
  items?: PurchaseDraftItem[];
  onAddItem?: () => void;
  onRemoveItem?: (itemId: string) => void;
  onUpdateItem?: (itemId: string, input: Partial<PurchaseDraftItem>) => void;
  productOptions?: PurchaseProductOption[];
  rateVes?: number;
};

function findProductLabel(productOptions: PurchaseProductOption[], productId: string) {
  return productOptions.find((option) => option.value === productId)?.label ?? "Selecciona producto";
}

export function PurchaseItemsTable({
  items = [
    { id: "PI-001", productId: "prod-cable", quantity: 12, unitCostRef: 2.8 },
    { id: "PI-002", productId: "prod-hammer", quantity: 24, unitCostRef: 1.1 },
  ],
  onAddItem,
  onRemoveItem,
  onUpdateItem,
  productOptions = [
    { label: "Cable THW 12", value: "prod-cable" },
    { label: "Martillo de una", value: "prod-hammer" },
  ],
  rateVes = 510,
}: PurchaseItemsTableProps) {
  const columns: DataTableColumn<PurchaseDraftItem>[] = [
    {
      header: "Producto",
      key: "product",
      render: (row) =>
        onUpdateItem ? (
          <SelectField
            aria-label="Producto"
            onChange={(event) => {
              const productId = event.target.value;
              const lastCostRef =
                productOptions.find((option) => option.value === productId)?.lastCostRef ??
                row.unitCostRef;

              onUpdateItem(row.id, { productId, unitCostRef: lastCostRef });
            }}
            options={productOptions}
            placeholder="Selecciona producto"
            value={row.productId}
          />
        ) : (
          findProductLabel(productOptions, row.productId)
        ),
    },
    {
      header: "Cantidad",
      key: "quantity",
      render: (row) =>
        onUpdateItem ? (
          <Input
            aria-label="Cantidad"
            min="1"
            onChange={(event) =>
              onUpdateItem(row.id, { quantity: Number(event.target.value) })
            }
            type="number"
            value={row.quantity}
          />
        ) : (
          row.quantity
        ),
    },
    {
      header: "Costo ref",
      key: "unitCostRef",
      render: (row) =>
        onUpdateItem ? (
          <Input
            aria-label="Costo ref"
            min="0"
            onChange={(event) =>
              onUpdateItem(row.id, { unitCostRef: Number(event.target.value) })
            }
            step="0.01"
            type="number"
            value={row.unitCostRef}
          />
        ) : (
          formatRef(row.unitCostRef)
        ),
    },
    {
      header: "Subtotal ref",
      key: "subtotalRef",
      render: (row) => formatRef(row.unitCostRef * row.quantity),
    },
    {
      header: "Subtotal VES",
      key: "subtotalVes",
      render: (row) => formatVes(refToVes(row.unitCostRef * row.quantity, rateVes)),
    },
  ];

  return (
    <DetailSection
      actions={
        <Button onClick={onAddItem} size="sm" type="button" variant="secondary">
          Agregar producto
        </Button>
      }
      description="Productos incluidos en la compra y costo unitario del proveedor."
      title="Productos de la compra"
    >
      <DataTable
        cardTitle={(row) => findProductLabel(productOptions, row.productId)}
        actions={
          onRemoveItem
            ? (row) => [
                {
                  label: "Quitar",
                  onSelect: () => onRemoveItem(row.id),
                  variant: "danger",
                },
              ]
            : undefined
        }
        columns={columns}
        data={items}
        getRowId={(row) => row.id}
      />
    </DetailSection>
  );
}
