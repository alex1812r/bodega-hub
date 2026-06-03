import { type ComponentPropsWithoutRef, type ReactNode } from "react";

import { Button } from "@/shared/components/Button";

type IconButtonProps = Omit<ComponentPropsWithoutRef<typeof Button>, "children" | "size"> & {
  "aria-label": string;
  icon: ReactNode;
};

export function IconButton({ icon, variant = "secondary", ...props }: IconButtonProps) {
  return (
    <Button size="icon" variant={variant} {...props}>
      {icon}
    </Button>
  );
}
