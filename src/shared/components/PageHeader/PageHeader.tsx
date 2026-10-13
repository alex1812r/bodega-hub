import { type ReactNode } from "react";

import { Typography } from "@/shared/components/Typography";
import { cn } from "@/shared/utils/cn";

type PageHeaderProps = {
  actions?: ReactNode;
  badge?: ReactNode;
  className?: string;
  description?: string;
  title: ReactNode;
};

/**
 * Encabezado de pantalla: título (con `badge` y `description` opcionales) y
 * acciones. Desde `sm` van en la misma línea mientras el título conserve al
 * menos 16rem; si las acciones no caben (4 o más botones, título largo), pasan
 * enteras a una segunda línea alineadas a la derecha y, si aun así no caben,
 * se reparten en varias. El título nunca se aplasta ni se parte letra a letra.
 */
export function PageHeader({
  actions,
  badge,
  className,
  description,
  title,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col justify-between gap-4 sm:flex-row sm:flex-wrap sm:items-center",
        className,
      )}
    >
      <div className="min-w-0 sm:grow sm:basis-64" data-page-header-title="">
        {badge ? <div className="mb-1">{badge}</div> : null}
        {typeof title === "string" ? (
          <Typography as="h1" variant="h1">
            {title}
          </Typography>
        ) : (
          title
        )}
        {description ? (
          <Typography className="mt-2 max-w-2xl" variant="muted">
            {description}
          </Typography>
        ) : null}
      </div>
      {actions ? (
        <div
          className="flex w-full shrink-0 flex-col gap-2 sm:ml-auto sm:w-auto sm:max-w-full sm:flex-row sm:flex-wrap sm:justify-end"
          data-page-header-actions=""
        >
          {actions}
        </div>
      ) : null}
    </div>
  );
}
