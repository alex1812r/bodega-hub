"use client";

import { Button } from "@/shared/components/Button";
import { Modal } from "@/shared/components/Modal";

import { PosBarcodeScannerIcon } from "./PosBarcodeScannerIcon";

type PosScanModalProps = {
  onFocusSearch?: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

export function PosScanModal({ onFocusSearch, onOpenChange, open }: PosScanModalProps) {
  return (
    <Modal
      description="Enfoca el buscador y escanea con tu lector USB. Al terminar, el lector envia Enter y el producto se agrega automaticamente."
      footer={({ close }) => (
        <div className="flex flex-wrap justify-end gap-2">
          {onFocusSearch ? (
            <Button
              onClick={() => {
                close();
                onFocusSearch();
              }}
              type="button"
              variant="outline"
            >
              Ir al buscador
            </Button>
          ) : null}
          <Button onClick={close} type="button" variant="primary">
            Entendido
          </Button>
        </div>
      )}
      onOpenChange={onOpenChange}
      open={open}
      title="Escanear producto"
    >
      <div className="flex flex-col items-center gap-4 py-6 text-center">
        <div className="flex size-16 items-center justify-center rounded-full bg-surface-container text-primary">
          <PosBarcodeScannerIcon className="size-8" />
        </div>
        <p className="text-sm text-muted-foreground">
          Coloca el cursor en el campo de busqueda del catalogo y escanea el codigo de barras. No
          necesitas abrir la camara: la mayoria de lectores funcionan como teclado.
        </p>
        <p className="rounded-lg border border-dashed border-border bg-surface-container-low px-4 py-3 text-xs font-medium text-muted-foreground">
          Escaneo por camara: proxima version
        </p>
      </div>
    </Modal>
  );
}
