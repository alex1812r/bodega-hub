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
        "group flex min-h-[400px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 transition-colors",
        isDragging
          ? "border-primary bg-surface-container-low"
          : "border-outline-variant bg-surface-container-lowest hover:bg-surface-container-low",
        disabled && "pointer-events-none opacity-60",
      )}
      onClick={() => !disabled && inputRef.current?.click()}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          inputRef.current?.click();
        }
      }}
      role="button"
      tabIndex={disabled ? -1 : 0}
    >
      <div className="mb-6 flex size-20 items-center justify-center rounded-full bg-surface-container transition-transform duration-300 group-hover:scale-110">
        <Upload aria-hidden className="size-10 text-primary" />
      </div>
      <h2 className="mb-2 text-lg font-semibold text-on-surface">
        Sube tu archivo de productos
      </h2>
      <p className="mb-6 max-w-md text-center text-sm text-on-surface-variant">
        Arrastra tu archivo aquí o haz clic para buscar en tu dispositivo. El formato
        debe ser <strong className="text-on-surface">.xlsx</strong> con la plantilla
        oficial.
      </p>
      {fileName ? (
        <p className="mb-4 text-sm font-medium text-primary">Archivo: {fileName}</p>
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
        className="shadow-sm"
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          inputRef.current?.click();
        }}
        type="button"
      >
        Seleccionar Archivo
      </Button>
      <p className="mt-8 text-xs text-outline">Tamaño máximo recomendado: 10MB</p>
    </div>
  );
}
