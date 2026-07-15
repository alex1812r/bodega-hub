import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ComponentProps } from "react";

import { Button } from "@/shared/components/Button";
import { cn } from "@/shared/utils/cn";

type PageBackButtonProps = {
  className?: string;
  href: string;
  label?: string;
  size?: ComponentProps<typeof Button>["size"];
};

export function PageBackButton({
  className,
  href,
  label = "Volver",
  size,
}: PageBackButtonProps) {
  return (
    <Button
      asChild
      className={cn("w-full gap-1 sm:w-auto", className)}
      size={size}
      variant="outline"
    >
      <Link href={href}>
        <ArrowLeft aria-hidden className="size-4" />
        {label}
      </Link>
    </Button>
  );
}
