"use client";

import { Wand2 } from "lucide-react";

import { IconButton } from "@/shared/components/IconButton";

type GenerateSkuIconButtonProps = {
  disabled?: boolean;
  onGenerate: () => void;
};

export function GenerateSkuIconButton({ disabled, onGenerate }: GenerateSkuIconButtonProps) {
  return (
    <IconButton
      aria-label="Generar SKU"
      className="size-8 shrink-0"
      disabled={disabled}
      icon={<Wand2 aria-hidden className="size-4" />}
      onClick={onGenerate}
      title="Generar SKU"
      type="button"
      variant="ghost"
    />
  );
}
