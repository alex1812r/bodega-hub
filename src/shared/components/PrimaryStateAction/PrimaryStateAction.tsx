import {
  CircleAlert,
  CircleCheck,
  Info,
  Loader2,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useId, type ReactNode } from "react";

import { ActionsMenu, type ActionMenuItem } from "@/shared/components/ActionsMenu";
import { Button } from "@/shared/components/Button";
import { Card } from "@/shared/components/Card";
import { Typography } from "@/shared/components/Typography";
import { cn } from "@/shared/utils/cn";

export const PRIMARY_STATE_ACTION_MAX_FIGURES = 4;

export type PrimaryStateFigureTone = "default" | "success" | "warning" | "danger";

export type PrimaryStateFigure = {
  /** Texto secundario bajo el valor (p. ej. el equivalente en Bs). */
  hint?: ReactNode;
  label: string;
  tone?: PrimaryStateFigureTone;
  value: ReactNode;
};

type PrimaryStateActionBase = {
  disabled?: boolean;
  /** Motivo visible y asociado al botón cuando `disabled` es verdadero. */
  disabledReason?: string;
  icon?: ReactNode;
  /** Bloquea la acción y muestra un indicador mientras se procesa. */
  isPending?: boolean;
  label: string;
  variant?: "primary" | "secondary" | "outline" | "danger";
};

export type PrimaryStateActionConfig = PrimaryStateActionBase &
  ({ href: string; onClick?: never } | { href?: never; onClick: () => void });

export type PrimaryStateNoticeTone = "info" | "success" | "warning" | "danger";

export type PrimaryStateNotice = {
  text: ReactNode;
  tone: PrimaryStateNoticeTone;
};

export type PrimaryStateActionProps = {
  /** Nombre accesible de la región. */
  ariaLabel?: string;
  className?: string;
  /** Cifras clave del documento. Se pintan como máximo cuatro. */
  figures: PrimaryStateFigure[];
  /** Aviso de estado que acompaña a la acción (p. ej. pedido sin recibir). */
  notice?: PrimaryStateNotice;
  /** Acción que corresponde al estado actual. Sin ella no se pinta botón. */
  primaryAction?: PrimaryStateActionConfig;
  /** Acciones secundarias: se agrupan en el menú "…". */
  secondaryActions?: ActionMenuItem[];
  secondaryActionsLabel?: string;
  /** Insignia de estado del documento. */
  status?: ReactNode;
};

const figureColumnClasses: Record<number, string> = {
  1: "sm:grid-cols-1",
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-4",
};

const figureToneClasses: Record<PrimaryStateFigureTone, string> = {
  default: "text-slate-950 dark:text-slate-100",
  success: "text-emerald-700 dark:text-emerald-300",
  warning: "text-amber-700 dark:text-amber-300",
  danger: "text-red-700 dark:text-red-300",
};

const noticeToneClasses: Record<PrimaryStateNoticeTone, string> = {
  info: "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950 dark:text-indigo-300",
  success:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
  warning:
    "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
  danger:
    "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
};

const noticeIcons: Record<PrimaryStateNoticeTone, LucideIcon> = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
};

function PrimaryButton({
  action,
  describedBy,
}: {
  action: PrimaryStateActionConfig;
  describedBy?: string;
}) {
  const isPending = action.isPending === true;
  const isBlocked = isPending || action.disabled === true;
  const content = (
    <>
      {isPending ? (
        <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
      ) : (
        action.icon
      )}
      <span className="truncate">{action.label}</span>
    </>
  );
  const className = "min-w-0 flex-1 sm:flex-none";

  if (action.href !== undefined && !isBlocked) {
    return (
      <Button asChild className={className} variant={action.variant}>
        <Link href={action.href}>{content}</Link>
      </Button>
    );
  }

  return (
    <Button
      aria-busy={isPending || undefined}
      aria-describedby={describedBy}
      className={className}
      disabled={isBlocked}
      onClick={action.onClick}
      variant={action.variant}
    >
      {content}
    </Button>
  );
}

export function PrimaryStateAction({
  ariaLabel = "Resumen y acciones",
  className,
  figures,
  notice,
  primaryAction,
  secondaryActions = [],
  secondaryActionsLabel = "Más acciones",
  status,
}: PrimaryStateActionProps) {
  const reasonId = useId();

  if (
    process.env.NODE_ENV !== "production" &&
    figures.length > PRIMARY_STATE_ACTION_MAX_FIGURES
  ) {
    console.warn(
      `PrimaryStateAction: se recibieron ${figures.length} cifras; solo se muestran las primeras ${PRIMARY_STATE_ACTION_MAX_FIGURES}.`,
    );
  }

  const visibleFigures = figures.slice(0, PRIMARY_STATE_ACTION_MAX_FIGURES);
  const hasSecondaryActions = secondaryActions.length > 0;
  const hasActions = primaryAction !== undefined || hasSecondaryActions;
  const disabledReason =
    primaryAction?.disabled && !primaryAction.isPending
      ? primaryAction.disabledReason
      : undefined;
  const NoticeIcon = notice ? noticeIcons[notice.tone] : null;

  return (
    <Card aria-label={ariaLabel} className={cn("space-y-4 p-4 sm:p-6", className)}>
      {status ? <div className="flex flex-wrap items-center gap-2">{status}</div> : null}

      {visibleFigures.length > 0 ? (
        <dl
          className={cn(
            "grid grid-cols-2 gap-3",
            figureColumnClasses[visibleFigures.length],
          )}
        >
          {visibleFigures.map((figure) => (
            <div
              className="min-w-0 rounded-xl border border-slate-100 bg-slate-50 p-3 sm:p-4 dark:border-slate-800 dark:bg-slate-950"
              key={figure.label}
            >
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {figure.label}
              </dt>
              <dd
                className={cn(
                  "mt-1 break-words text-base font-semibold tabular-nums leading-6 sm:text-lg",
                  figureToneClasses[figure.tone ?? "default"],
                )}
              >
                {figure.value}
                {figure.hint ? (
                  <span className="mt-0.5 block break-words text-xs font-normal leading-4 text-slate-500 dark:text-slate-400">
                    {figure.hint}
                  </span>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {notice || hasActions ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {notice && NoticeIcon ? (
            <div
              className={cn(
                "flex min-w-0 items-start gap-2 rounded-lg border px-3 py-2 text-sm leading-5 sm:flex-1",
                noticeToneClasses[notice.tone],
              )}
              role={notice.tone === "danger" ? "alert" : "status"}
            >
              <NoticeIcon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="min-w-0 break-words">{notice.text}</span>
            </div>
          ) : null}

          {hasActions ? (
            <div className="flex min-w-0 flex-col gap-1 sm:ml-auto sm:items-end">
              <div className="flex items-center justify-end gap-2">
                {primaryAction ? (
                  <PrimaryButton
                    action={primaryAction}
                    describedBy={disabledReason ? reasonId : undefined}
                  />
                ) : null}
                {hasSecondaryActions ? (
                  <ActionsMenu
                    actions={secondaryActions}
                    label={secondaryActionsLabel}
                    variant="outline"
                  />
                ) : null}
              </div>
              {disabledReason ? (
                <Typography id={reasonId} variant="caption">
                  {disabledReason}
                </Typography>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
