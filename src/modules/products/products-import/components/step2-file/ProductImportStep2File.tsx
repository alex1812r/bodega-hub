"use client";

import { ArrowRight } from "lucide-react";

import { Button } from "@/shared/components/Button";
import { ErrorState } from "@/shared/components/ErrorState";
import { LoadingState } from "@/shared/components/LoadingState";

import { ProductImportDropzone } from "./ProductImportDropzone";

type ProductImportStep2FileProps = {
  errorMessage: string | null;
  fileName: string | null;
  isParsing: boolean;
  onBack: () => void;
  onFileSelected: (file: File) => void;
};

export function ProductImportStep2File({
  errorMessage,
  fileName,
  isParsing,
  onBack,
  onFileSelected,
}: ProductImportStep2FileProps) {
  const canContinue = Boolean(fileName) && !isParsing;

  return (
    <div className="flex flex-col gap-8">
      <ProductImportDropzone
        disabled={isParsing}
        fileName={fileName}
        onFileSelected={onFileSelected}
      />
      {isParsing ? (
        <LoadingState
          description="Validando filas del archivo..."
          title="Procesando archivo"
          variant="inline"
        />
      ) : null}
      {errorMessage ? (
        <ErrorState description={errorMessage} title="No se pudo procesar el archivo" />
      ) : null}
      <div className="flex items-center justify-between border-t border-outline-variant/30 pt-8">
        <Button className="shadow-sm" onClick={onBack} type="button" variant="outline">
          Atrás
        </Button>
        <Button
          className="gap-2 shadow-sm"
          disabled={!canContinue}
          type="button"
        >
          Continuar
          <ArrowRight aria-hidden className="size-4" />
        </Button>
      </div>
    </div>
  );
}
