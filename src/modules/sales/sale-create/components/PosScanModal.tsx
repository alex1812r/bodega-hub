"use client";

import { Button } from "@/shared/components/Button";
import { Modal } from "@/shared/components/Modal";

import { PosCameraBarcodeScanner } from "./PosCameraBarcodeScanner";

type PosScanModalProps = {
  isLookingUp?: boolean;
  onDetected: (code: string) => void;
  onFocusSearch?: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  scanError?: string | null;
};

export function PosScanModal({
  isLookingUp = false,
  onDetected,
  onFocusSearch,
  onOpenChange,
  open,
  scanError,
}: PosScanModalProps) {
  return (
    <Modal
      contentClassName="sm:max-w-lg"
      description="Usa la camara para leer el codigo, o el lector USB con el buscador enfocado."
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
              Usar buscador / USB
            </Button>
          ) : null}
          <Button onClick={close} type="button" variant="primary">
            Cerrar
          </Button>
        </div>
      )}
      onOpenChange={onOpenChange}
      open={open}
      title="Escanear producto"
    >
      <div className="space-y-3">
        {open ? (
          <PosCameraBarcodeScanner
            key="pos-camera-scanner"
            onDetected={onDetected}
            paused={isLookingUp}
          />
        ) : null}

        {scanError ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300" role="alert">
            {scanError}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
