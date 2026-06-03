import { cva, type VariantProps } from "class-variance-authority";
import { type ComponentPropsWithoutRef, type ElementType } from "react";

import { cn } from "@/shared/utils/cn";

const typographyVariants = cva("text-slate-950 dark:text-slate-100", {
  variants: {
    variant: {
      display: "text-4xl font-semibold tracking-tight md:text-5xl",
      h1: "text-3xl font-semibold tracking-tight",
      h2: "text-2xl font-semibold tracking-tight",
      h3: "text-xl font-semibold",
      body: "text-base leading-7",
      muted: "text-sm leading-6 text-slate-500 dark:text-slate-400",
      label: "text-sm font-medium",
      caption: "text-xs leading-5 text-slate-500 dark:text-slate-400",
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
