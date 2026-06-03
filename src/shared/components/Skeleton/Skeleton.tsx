import { type HTMLAttributes } from "react";

import { cn } from "@/shared/utils/cn";

type SkeletonProps = HTMLAttributes<HTMLDivElement> & {
  variant?: "block" | "text" | "circle";
};

export function Skeleton({
  className,
  variant = "block",
  ...props
}: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "animate-pulse bg-slate-200 dark:bg-slate-800",
        variant === "block" && "h-10 rounded-lg",
        variant === "text" && "h-4 rounded-full",
        variant === "circle" && "h-10 w-10 rounded-full",
        className,
      )}
      {...props}
    />
  );
}
