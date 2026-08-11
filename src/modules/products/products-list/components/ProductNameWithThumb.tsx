"use client";

import { Package } from "lucide-react";
import { useState } from "react";

import { cn } from "@/shared/utils/cn";

type ProductNameWithThumbProps = {
  imageUrl?: string | null;
  isActive?: boolean;
  name: string;
};

export function ProductNameWithThumb({
  imageUrl,
  isActive = true,
  name,
}: ProductNameWithThumbProps) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(imageUrl) && !failed;

  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <span
        className={cn(
          "relative inline-flex size-9 shrink-0 overflow-hidden rounded-md bg-surface-container",
          !isActive && "opacity-60",
        )}
      >
        {showImage ? (
          // Native img: avoids next/image config crashes for many tiny remote thumbs in tables.
          // eslint-disable-next-line @next/next/no-img-element -- list thumbnails are unoptimized remote URLs
          <img
            alt=""
            className="size-full object-cover"
            loading="lazy"
            onError={() => setFailed(true)}
            src={imageUrl!}
          />
        ) : (
          <span className="flex size-full items-center justify-center text-muted-foreground">
            <Package aria-hidden className="size-4 opacity-60" strokeWidth={1.5} />
          </span>
        )}
      </span>
      <span
        className={cn(
          "line-clamp-2 min-w-0 text-sm leading-snug",
          isActive ? "text-foreground" : "text-outline",
        )}
        title={name}
      >
        {name}
      </span>
    </span>
  );
}
