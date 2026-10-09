"use client";

import { Receipt, ShoppingCart, Wallet } from "lucide-react";
import Link from "next/link";
import { type ReactNode } from "react";

import { EmptyState } from "@/shared/components/EmptyState";
import { ErrorState } from "@/shared/components/ErrorState";
import { LoadingState } from "@/shared/components/LoadingState";
import { formatVesBs } from "@/shared/utils/currency";
import { cn } from "@/shared/utils/cn";

export type ContactActivityTimelineItem = {
  amountVes: number;
  createdAt: string;
  dateLabel: string;
  description: string;
  id: string;
  title: ReactNode;
  type: "venta" | "compra" | "pago";
};

const typeConfig = {
  compra: {
    circleClassName: "border-surface-container-lowest bg-primary/15 text-primary",
    icon: ShoppingCart,
  },
  pago: {
    circleClassName: "border-surface-container-lowest bg-emerald-100 text-emerald-600",
    icon: Wallet,
  },
  venta: {
    circleClassName: "border-surface-container-lowest bg-amber-100 text-amber-700",
    icon: Receipt,
  },
} as const;

type ContactActivityTimelineProps = {
  error?: Error | string | null;
  isFetching?: boolean;
  isLoading?: boolean;
  items: ContactActivityTimelineItem[];
  onRetry?: () => void;
};

export function ContactActivityTimeline({
  error,
  isFetching,
  isLoading,
  items,
  onRetry,
}: ContactActivityTimelineProps) {
  if (isLoading) {
    return (
      <LoadingState
        description="Consultando movimientos recientes."
        title="Cargando actividad"
        variant="inline"
      />
    );
  }

  if (error) {
    return (
      <ErrorState
        description={
          error instanceof Error ? error.message : "No pudimos cargar la actividad."
        }
        onRetry={onRetry}
        title="Error al cargar actividad"
      />
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        description="Aquí aparecerán sus ventas, compras y pagos."
        title="Sin actividad registrada"
      />
    );
  }

  return (
    <div
      className={cn(
        "relative ml-4 flex flex-col gap-8 border-l-2 border-outline-variant/30 py-2",
        isFetching && "opacity-70",
      )}
    >
      {items.map((item) => {
        const config = typeConfig[item.type];
        const Icon = config.icon;

        return (
          <article className="relative pl-8" key={item.id}>
            <div
              aria-hidden
              className={cn(
                "absolute -left-[17px] top-0 flex size-8 items-center justify-center rounded-full border-2",
                config.circleClassName,
              )}
            >
              <Icon className="size-4" />
            </div>
            <p className="mb-1 text-xs text-on-surface-variant">{item.dateLabel}</p>
            <p className="text-sm font-medium text-foreground">{item.title}</p>
            <p className="mt-1 text-sm text-on-surface-variant">{item.description}</p>
          </article>
        );
      })}
    </div>
  );
}

export function buildActivityTimelineItems(
  rows: {
    amountVes: number;
    createdAt: string;
    /** Detalle del documento; sin él, el código se pinta como texto. */
    href?: string;
    id: string;
    type: "venta" | "compra" | "pago";
  }[],
  formatDateLabel: (isoDate: string) => string,
): ContactActivityTimelineItem[] {
  const typeCopy = {
    compra: {
      action: "Compra registrada",
      prefix: "COM",
    },
    pago: {
      action: "Pago registrado",
      prefix: "PAG",
    },
    venta: {
      action: "Venta registrada",
      prefix: "VEN",
    },
  } as const;

  return rows.map((row) => {
    const copy = typeCopy[row.type];
    const code = `${copy.prefix}-${row.id.slice(-4).toUpperCase()}`;

    return {
      amountVes: row.amountVes,
      createdAt: row.createdAt,
      dateLabel: formatDateLabel(row.createdAt),
      description: `Monto: ${formatVesBs(row.amountVes)}.`,
      id: row.id,
      title: (
        <>
          {copy.action}:{" "}
          {row.href ? (
            <Link className="text-primary hover:underline dark:text-indigo-300" href={row.href}>
              {code}
            </Link>
          ) : (
            <span className="text-primary dark:text-indigo-300">{code}</span>
          )}
        </>
      ),
      type: row.type,
    };
  });
}
