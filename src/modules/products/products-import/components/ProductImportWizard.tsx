"use client";

import Link from "next/link";

import { getPaginatedItems } from "@/lib/api/pagination";
import { Badge } from "@/shared/components/Badge";
import { Button } from "@/shared/components/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/components/Card";
import { ErrorState } from "@/shared/components/ErrorState";
import { LoadingState } from "@/shared/components/LoadingState";

import { useCategories } from "../../hooks/useProducts";
import { useProductBulkImport } from "../hooks/useProductBulkImport";
import { ProductImportDropzone } from "./ProductImportDropzone";
import { ProductImportErrorPolicyToggle } from "./ProductImportErrorPolicyToggle";
import { ProductImportPreviewTable } from "./ProductImportPreviewTable";
import { ProductImportProgressPanel } from "./ProductImportProgress";
import { ProductImportSummary } from "./ProductImportSummary";

const STEPS = [
  { id: "template", label: "Plantilla" },
  { id: "file", label: "Archivo" },
  { id: "preview", label: "Preview" },
  { id: "importing", label: "Importacion" },
  { id: "summary", label: "Resumen" },
] as const;

export function ProductImportWizard() {
  const categories = useCategories();
  const bulk = useProductBulkImport({
    categories: getPaginatedItems(categories.data),
  });

  if (categories.isLoading) {
    return <LoadingState description="Cargando categorias para validar el archivo." title="Preparando importacion..." />;
  }

  if (categories.isError) {
    return (
      <ErrorState
        description={categories.error.message}
        onRetry={() => void categories.refetch()}
        title="No se pudieron cargar las categorias"
      />
    );
  }

  const currentStepIndex = STEPS.findIndex((step) => step.id === bulk.step);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {STEPS.map((step, index) => (
          <Badge
            key={step.id}
            variant={index <= currentStepIndex ? "info" : "default"}
          >
            {index + 1}. {step.label}
          </Badge>
        ))}
      </div>

      {bulk.step === "template" ? (
        <Card>
          <CardHeader>
            <CardTitle>Descargar plantilla</CardTitle>
            <CardDescription>
              Use el formato oficial. La columna categoria tiene lista desplegable con sus categorias.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Categorias disponibles:{" "}
              {getPaginatedItems(categories.data).length > 0
                ? getPaginatedItems(categories.data)
                    .map((category) => category.name)
                    .join(", ")
                : "ninguna (puede dejar categoria vacia)."}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={bulk.isDownloadingTemplate}
                onClick={() => void bulk.downloadTemplate()}
                type="button"
              >
                {bulk.isDownloadingTemplate ? "Descargando..." : "Descargar plantilla Excel"}
              </Button>
              <Button onClick={() => bulk.setStep("file")} type="button" variant="outline">
                Ya tengo mi archivo
              </Button>
              <Button asChild type="button" variant="ghost">
                <Link href="/products">Cancelar</Link>
              </Button>
            </div>
            {bulk.templateDownloadMessage ? (
              <p className="text-sm text-slate-600 dark:text-slate-400">
                {bulk.templateDownloadMessage}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {bulk.step === "file" ? (
        <div className="space-y-4">
          <ProductImportDropzone
            disabled={bulk.status === "parsing"}
            fileName={bulk.fileName}
            onFileSelected={(file) => void bulk.parseFile(file)}
          />
          {bulk.status === "parsing" ? (
            <LoadingState description="Validando filas del archivo..." variant="inline" />
          ) : null}
          {bulk.errorMessage ? (
            <ErrorState description={bulk.errorMessage} title="No se pudo procesar el archivo" />
          ) : null}
          <Button onClick={() => bulk.setStep("template")} type="button" variant="ghost">
            Volver
          </Button>
        </div>
      ) : null}

      {bulk.step === "preview" ? (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3 text-sm">
            <Badge variant="success">{bulk.validCount} validas</Badge>
            <Badge variant="warning">{bulk.warningCount} advertencias</Badge>
            <Badge variant="danger">{bulk.errorCount} errores</Badge>
            <Badge variant="info">{bulk.importableCount} importables</Badge>
          </div>
          <ProductImportPreviewTable rows={bulk.validatedRows} />
          <ProductImportErrorPolicyToggle
            onChange={bulk.setErrorPolicy}
            value={bulk.errorPolicy}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={bulk.importableCount === 0}
              onClick={() => void bulk.startImport()}
              type="button"
            >
              Importar {bulk.importableCount} productos
            </Button>
            <Button onClick={() => bulk.setStep("file")} type="button" variant="outline">
              Elegir otro archivo
            </Button>
          </div>
        </div>
      ) : null}

      {bulk.step === "importing" ? (
        <div className="space-y-4">
          <ProductImportProgressPanel progress={bulk.progress} />
          <Button onClick={bulk.cancelImport} type="button" variant="danger">
            Cancelar importacion
          </Button>
        </div>
      ) : null}

      {bulk.step === "summary" ? (
        <ProductImportSummary
          cancelled={bulk.status === "cancelled"}
          onReset={bulk.reset}
          results={bulk.results}
        />
      ) : null}
    </div>
  );
}
