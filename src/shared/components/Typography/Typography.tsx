import { cva, type VariantProps } from "class-variance-authority";
import { type ComponentPropsWithoutRef, type ElementType } from "react";

import { cn } from "@/shared/utils/cn";

const typographyVariants = cva("text-foreground", {
  variants: {
    variant: {
      display:
        "text-[28px] font-bold leading-9 tracking-[-0.02em] md:text-[36px] md:leading-[44px]",
      h1: "text-2xl font-semibold leading-8 tracking-[-0.01em]",
      h2: "text-xl font-semibold leading-7",
      h3: "text-lg font-semibold leading-7",
      body: "text-sm leading-5",
      "body-lg": "text-base leading-6",
      muted: "text-sm leading-5 text-muted-foreground",
      label: "text-sm font-medium leading-5",
      caption: "text-xs leading-4 text-muted-foreground",
      "table-label":
        "text-xs font-semibold uppercase tracking-wider text-muted-foreground",
    },
  },
  defaultVariants: {
    variant: "body",
  },
});

type TypographyProps<T extends ElementType> = {
  as?: T;
} & VariantProps<typeof typographyVariants> &
  Omit<ComponentPropsWithoutRef<T>, "as">;

export function Typography<T extends ElementType = "p">({
  as,
  className,
  variant,
  ...props
}: TypographyProps<T>) {
  const Component = as ?? "p";

  return (
    <Component className={cn(typographyVariants({ variant }), className)} {...props} />
  );
}
