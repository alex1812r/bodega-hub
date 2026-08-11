"use client";

import { Package } from "lucide-react";
import Image from "next/image";
import { useState } from "react";

import { cn } from "@/shared/utils/cn";

type PosProductImageProps = {
  alt: string;
  className?: string;
  /** Thumbnail compacto (carrito POS): icono mas pequeno. */
  compact?: boolean;
  imageUrl?: string;
};

export function PosProductImage({ alt, className, compact = false, imageUrl }: PosProductImageProps) {
  const [failed, setFailed] = useState(false);
  const showPlaceholder = !imageUrl || failed;
  if (showPlaceholder) {
    return (
      <div
        className={cn(
          "flex size-full items-center justify-center bg-surface-container text-muted-foreground",
          className,
        )}
      >
        <Package
          aria-hidden
          className={cn(compact ? "size-6" : "size-10", "opacity-60")}
          strokeWidth={1.25}
        />
        <span className="sr-only">{alt}</span>
      </div>
    );
  }

  return (
    <Image
      alt={alt}
      className={cn("size-full object-cover", className)}
      height={160}
      onError={() => setFailed(true)}
      src={imageUrl}
      unoptimized
      width={160}
    />
  );
}
