"use client";

import { useEffect, useState } from "react";

import { useAddProductBarcode, type ProductWithCategory } from "@/modules/products/hooks/useProducts";
import { normalizeBarcode } from "@/modules/products/services/productSearch";
import { PosBarcodeScannerIcon } from "@/modules/sales/sale-create/components/PosBarcodeScannerIcon";
import { PosCameraBarcodeScanner } from "@/modules/sales/sale-create/components/PosCameraBarcodeScanner";
import { Button } from "@/shared/components/Button";
import { Input } from "@/shared/components/Input";
import { Modal } from "@/shared/components/Modal";

type AddProductBarcodeModalProps = {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  product: ProductWithCategory | null;
};

export function AddProductBarcodeModal({
  onOpenChange,
  open,
  product,
}: AddProductBarcodeModalProps) {
  const addBarcode = useAddProductBarcode(product?.id ?? "");
  const [barcode, setBarcode] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setBarcode("");
      setCameraOpen(false);
      setErrorMessage(null);
      return;
    }

    setBarcode("");
    setCameraOpen(false);
    setErrorMessage(null);
  }, [open, product?.id]);

  async function handleSubmit() {
    const normalized = normalizeBarcode(barcode);
    if (!normalized) {
      setErrorMessage("Ingresa o escanea un codigo de barras.");
      return;
    }

    if (!product) {
      return;
    }

    try {
      setErrorMessage(null);
      await addBarcode.mutateAsync({ barcode: normalized });
      onOpenChange(false);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "No se pudo guardar el codigo de barras.",
      );
    }
  }

  return (
    <Modal
      contentClassName="sm:max-w-lg"
      description={
        product
          ? `Asigna el codigo de barras a “${product.name}”. Solo se puede agregar si aun no tiene uno.`
          : "Asigna el codigo de barras del producto."
      }
      footer={({ close }) => (
        <>
          <Button
            disabled={addBarcode.isPending}
            onClick={() => {
              setCameraOpen(false);
              close();
            }}
            type="button"
            variant="outline"
          >
            Cancelar
          </Button>
          <Button
            disabled={addBarcode.isPending || !barcode.trim()}
            onClick={() => void handleSubmit()}
            type="button"
          >
            {addBarcode.isPending ? "Guardando..." : "Guardar codigo"}
          </Button>
        </>
      )}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setCameraOpen(false);
          setBarcode("");
          setErrorMessage(null);
        }
        onOpenChange(nextOpen);
      }}
      open={open}
      title="Agregar codigo de barras"
    >
      <div className="grid gap-3">
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Input
              autoComplete="off"
              label="Codigo de barras"
              onChange={(event) => setBarcode(event.target.value)}
              placeholder="Escribe o escanea el codigo"
              value={barcode}
            />
          </div>
          <Button
            aria-label={cameraOpen ? "Cerrar camara" : "Abrir camara para escanear"}
            aria-pressed={cameraOpen}
            className="shrink-0"
            onClick={() => setCameraOpen((current) => !current)}
            type="button"
            variant="outline"
          >
            <PosBarcodeScannerIcon />
          </Button>
        </div>

        {cameraOpen && open ? (
          <div className="space-y-2">
            <PosCameraBarcodeScanner
              key={`add-barcode-camera-${product?.id ?? "none"}`}
              onDetected={(code) => {
                setBarcode(code);
                setCameraOpen(false);
                setErrorMessage(null);
              }}
            />
            <p className="text-xs text-muted-foreground">
              Apunta la camara al codigo. Al detectarlo se completa el campo.
            </p>
          </div>
        ) : null}

        {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}
      </div>
    </Modal>
  );
}
