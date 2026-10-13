/** Shared field styles aligned with BodegaHub / Stitch form controls. */

/** Listados y POS: fondo `bg-surface` como el buscador del catálogo. */
export const stitchListFilterFieldClassName =
  "h-10 w-full rounded-lg border border-border/80 bg-surface px-3 text-sm text-foreground shadow-sm outline-none transition-colors placeholder:text-muted-foreground/80 focus:border-primary focus:ring-1 focus:ring-primary/25 dark:border-slate-700";

export const stitchListFilterLabelClassName =
  "mb-1 block text-xs font-semibold text-on-surface-variant";

export const formLabelClassName =
  "text-sm font-medium text-foreground";

export const formControlClassName =
  "h-10 w-full rounded border border-border bg-surface-container-lowest px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:bg-surface-container disabled:text-muted-foreground";

export const formControlErrorClassName =
  "border-red-500 focus:border-red-500 focus:ring-red-100 dark:focus:ring-red-950";

export const formHelperClassName = "text-xs text-muted-foreground";

export const formHelperErrorClassName = "text-red-600 dark:text-red-400";

/** Aviso no bloqueante bajo un campo (p. ej. el de miles de `NumberInput`). */
export const formNoticeClassName = "text-xs text-amber-800 dark:text-amber-300";

/** Borde del campo mientras tiene un aviso (sin error, que manda). */
export const formControlNoticeClassName =
  "border-amber-500 focus:border-amber-500 focus:ring-amber-200 dark:border-amber-600 dark:focus:ring-amber-950";

/** El mismo aviso anclado al campo con `position: fixed` (`FloatingFieldNotice`). */
export const formFloatingNoticeClassName =
  "pointer-events-none fixed z-[60] w-56 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-left text-xs font-normal text-amber-800 shadow-md dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300";

export const formTextareaClassName =
  "min-h-24 w-full rounded border border-border bg-surface-container-lowest px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:bg-surface-container disabled:text-muted-foreground";
