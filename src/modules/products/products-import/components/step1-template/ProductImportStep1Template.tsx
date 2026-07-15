"use client";

import { ArrowRight, FileDown } from "lucide-react";
import Link from "next/link";

import { ProductImportStepPanel } from "../shared/ProductImportStepPanel";
import { ProductImportColumnDictionary } from "./ProductImportColumnDictionary";
import { ProductImportLimitCallout } from "./ProductImportLimitCallout";

type ProductImportStep1TemplateProps = {
  categoryNames: string[];
  isDownloading: boolean;
  onContinue: () => void;
  onDownload: () => void;
  templateMessage: string | null;
};

export function ProductImportStep1Template({
  categoryNames,
  isDownloading,
  onContinue,
  onDownload,
  templateMessage,
}: ProductImportStep1TemplateProps) {
  return (
    <ProductImportStepPanel
      footer={
        <>
          <Link className="product-import-link-cancel" href="/products">
            Cancelar
          </Link>
          <button
            className="product-import-btn-secondary"
            onClick={onContinue}
            type="button"
          >
            Continuar al Paso 2
            <ArrowRight aria-hidden className="size-[18px]" />
          </button>
        </>
      }
      header={
        <>
          <div>
            <h2 className="text-lg font-semibold text-on-surface">
              Paso 1: Estructura de Datos
            </h2>
            <p className="mt-1 text-sm text-on-surface-variant">
              Descarga la plantilla base y completa la información respetando el
              formato de las columnas.
            </p>
          </div>
          <button
            className="product-import-btn-primary"
            disabled={isDownloading}
            onClick={() => void onDownload()}
            type="button"
          >
            <FileDown aria-hidden className="size-5" />
            {isDownloading ? "Descargando..." : "Descargar plantilla .xlsx"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-6">
        <ProductImportLimitCallout />
        {categoryNames.length > 0 ? (
          <p className="text-sm text-on-surface-variant">
            <span className="font-medium text-on-surface">Categorías en plantilla:</span>{" "}
            {categoryNames.join(", ")}
          </p>
        ) : null}
        {templateMessage ? (
          <p className="text-sm text-on-surface-variant">{templateMessage}</p>
        ) : null}
        <ProductImportColumnDictionary />
      </div>
    </ProductImportStepPanel>
  );
}
