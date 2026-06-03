"use client";

import { Upload } from "lucide-react";
import { type ChangeEvent, type DragEvent, useRef, useState } from "react";

import { Button } from "@/shared/components/Button";
import { cn } from "@/shared/utils/cn";

type ProductImportDropzoneProps = {
  disabled?: boolean;
  fileName?: string | null;
  onFileSelected: (file: File) => void;
};

export function ProductImportDropzone({
  disabled = false,
  fileName,
  onFileSelected,
}: ProductImportDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  function acceptFile(file: File | undefined) {
    if (!file || disabled) {
      return;
    }

    onFileSelected(file);
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    acceptFile(event.target.files?.[0]);
    event.target.value = "";
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();

    if (!disabled) {
      setIsDragging(true);
    }
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    acceptFile(event.dataTransfer.files?.[0]);
  }

  return (
    <div
      className={cn(
        "rounded-xl border border-dashed bg-white p-8 text-center dark:bg-slate-900",
        isDragging
          ? "border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950"
          : "border-slate-300 dark:border-slate-700",
      )}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <Upload aria-hidden className="mx-auto h-10 w-10 text-slate-400" />
      <p className="mt-4 text-sm font-medium text-slate-900 dark:text-slate-100">
        Arrastra tu archivo Excel o seleccionalo
      </p>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Solo archivos .xlsx con la plantilla oficial (max. 500 filas).
      </p>
      {fileName ? (
        <p className="mt-3 text-sm text-blue-700 dark:text-blue-300">Archivo: {fileName}</p>
      ) : null}
      <input
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        disabled={disabled}
        onChange={handleChange}
        ref={inputRef}
        type="file"
      />
      <Button
        className="mt-4"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        type="button"
        variant="outline"
      >
        Seleccionar archivo
      </Button>
    </div>
  );
}
