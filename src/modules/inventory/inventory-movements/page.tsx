"use client";

import { useMemo, useState } from "react";

import { getPaginatedItems } from "@/lib/api/pagination";
import { ResponsivePagination, usePaginationState } from "@/shared/components/Pagination";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/Card";
import { EmptyState } from "@/shared/components/EmptyState";
import { EntityListPage } from "@/shared/components/EntityListPage";
import { FilterPanel } from "@/shared/components/FilterPanel";
import { Input } from "@/shared/components/Input";
import { SelectField } from "@/shared/components/SelectField";
import type { StockMovementType } from "@/shared/mocks/erp-data";

import { InventoryAdjustmentModal } from "./components/InventoryAdjustmentModal";
import { InventoryMovementDetailModal } from "./components/InventoryMovementDetailModal";
import {
  InventoryMovementsTable,
  type InventoryMovementRow,
} from "./components/InventoryMovementsTable";
import {
  useInventory,
  useInventoryMovements,
  useStockCard,
  type InventoryMovement,
} from "../hooks/useInventory";

const movementTypeOptions: Array<{ label: string; value: StockMovementType }> = [
  { label: "Ajuste entrada", value: "ajuste_entrada" },
  { label: "Ajuste salida", value: "ajuste_salida" },
  { label: "Venta", value: "venta" },
  { label: "Compra", value: "compra" },
  { label: "Devolucion cliente", value: "devolucion_cliente" },
  { label: "Devolucion proveedor", value: "devolucion_proveedor" },
  { label: "Inventario inicial", value: "inventario_inicial" },
];

function formatDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-");

  return `${day}/${month}/${year}`;
}

function toMovementRow(movement: InventoryMovement): InventoryMovementRow {
  return {
    date: formatDate(movement.createdAt),
    id: movement.id,
    product: movement.product?.name ?? movement.productId,
    quantity: movement.quantityDelta,
    reason: movement.reason,
    stockAfter: movement.stockAfter,
    type: movement.type,
  };
}

function StockCardPanel({ productId }: { productId: string }) {
  const stockCardQuery = useStockCard({ productId });
  const stockCardRows = useMemo(
    () => getPaginatedItems(stockCardQuery.data).map(toMovementRow),
    [stockCardQuery.data],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Kardex base</CardTitle>
        <CardDescription>
          Tarjeta de stock del producto seleccionado, obtenida desde la API.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {productId ? (
          <InventoryMovementsTable
            error={stockCardQuery.error}
            isFetching={stockCardQuery.isFetching}
            isLoading={stockCardQuery.isLoading}
            onRetry={() => void stockCardQuery.refetch()}
            rows={stockCardRows}
          />
        ) : (
          <EmptyState
            description="Elige un producto en los filtros para ver su kardex."
            title="Selecciona un producto"
          />
        )}
      </CardContent>
    </Card>
  );
}

export function InventoryMovementsPage() {
  const [productId, setProductId] = useState("");
  const [type, setType] = useState("");
  const [date, setDate] = useState("");
  const [selectedMovement, setSelectedMovement] = useState<InventoryMovement | null>(null);
  const { limit, setLimit, setSkip, skip } = usePaginationState([productId, type, date]);
  const productsQuery = useInventory({ limit: 100 });
  const movementsQuery = useInventoryMovements({ limit, productId: productId || undefined, skip });
  const productOptions = useMemo(
    () =>
      getPaginatedItems(productsQuery.data).map((product) => ({
        label: `${product.name} (${product.sku})`,
        value: product.id,
      })),
    [productsQuery.data],
  );
  const filteredMovements = useMemo(() => {
    return getPaginatedItems(movementsQuery.data)
      .filter((movement) => !type || movement.type === type)
      .filter((movement) => !date || movement.createdAt.startsWith(date));
  }, [date, movementsQuery.data, type]);
  const movementRows = useMemo(
    () => filteredMovements.map(toMovementRow),
    [filteredMovements],
  );
  const movementsById = useMemo(
    () => new Map(filteredMovements.map((movement) => [movement.id, movement])),
    [filteredMovements],
  );

  return (
    <EntityListPage
      actions={<InventoryAdjustmentModal />}
      description="Movimientos visuales de entradas, salidas, ventas, compras y ajustes."
      title="Movimientos de inventario"
    >
      <FilterPanel>
        <SelectField
          disabled={productsQuery.isLoading}
          helperText={
            productsQuery.error
              ? "No pudimos cargar los productos para filtrar."
              : undefined
          }
          label="Producto"
          onChange={(event) => setProductId(event.target.value)}
          options={productOptions}
          placeholder="Todos"
          value={productId}
        />
        <SelectField
          label="Tipo"
          onChange={(event) => setType(event.target.value)}
          options={movementTypeOptions}
          placeholder="Todos"
          value={type}
        />
        <Input
          label="Fecha"
          onChange={(event) => setDate(event.target.value)}
          type="date"
          value={date}
        />
      </FilterPanel>
      <InventoryMovementsTable
        actions={(row) => [
          {
            label: "Ver detalle",
            onSelect: () => setSelectedMovement(movementsById.get(row.id) ?? null),
          },
        ]}
        error={movementsQuery.error}
        isFetching={movementsQuery.isFetching}
        isLoading={movementsQuery.isLoading}
        onRetry={() => void movementsQuery.refetch()}
        rows={movementRows}
      />
      <ResponsivePagination
        isDisabled={movementsQuery.isFetching}
        limit={limit}
        onLimitChange={setLimit}
        onSkipChange={setSkip}
        skip={movementsQuery.data?.skip ?? skip}
        total={movementsQuery.data?.total ?? 0}
      />
      <InventoryMovementDetailModal
        movement={selectedMovement}
        onClose={() => setSelectedMovement(null)}
      />
      <StockCardPanel productId={productId} />
    </EntityListPage>
  );
}
