/** Campos inline y búsqueda alineados a Registrar Compra (Stitch). */
export const purchaseFormInputClassName =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary/25 dark:border-slate-700";

export const purchaseInlineInputClassName =
  "rounded border border-border bg-surface text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/25 dark:border-slate-700";

export const purchaseFormLabelClassName =
  "mb-1 block text-xs font-semibold text-on-surface-variant";

/** Caja de campo en filas de compra: label + control alineados. */
export const purchaseLineFieldBoxClassName =
  "flex flex-col gap-0 rounded-md border border-border bg-surface-container-lowest px-2 py-1 dark:border-slate-700";

export const purchaseLineFieldBoxLockedClassName =
  "flex flex-col gap-0 rounded-md border border-dashed border-border/80 bg-surface-container-low/60 px-2 py-1 dark:border-slate-700";

export const purchaseLineFieldLabelClassName =
  "text-[0.65rem] font-medium leading-tight tracking-wide text-on-surface-variant uppercase";

export const purchaseLineFieldControlClassName =
  "h-7 w-full border-0 bg-transparent p-0 text-sm leading-7 text-foreground outline-none [color-scheme:light] focus:ring-0 dark:bg-transparent dark:[color-scheme:dark]";

/** Select nativo: popup legible en dark mode (color-scheme + option). */
export const purchaseLineFieldSelectClassName = [
  purchaseLineFieldControlClassName,
  "cursor-pointer text-xs",
  "[&>option]:bg-white [&>option]:text-slate-900",
  "dark:[&>option]:bg-slate-900 dark:[&>option]:text-slate-100",
].join(" ");

/**
 * Columnas de una línea de compra. Depende del ancho de la tarjeta (`@container`), no
 * del viewport: apilada (producto arriba, tres celdas debajo) hasta 36rem y, desde ahí,
 * producto · cantidad · costo · total · quitar en una sola fila.
 */
export const purchaseLineGridClassName =
  "grid grid-cols-3 items-center gap-x-3 gap-y-2 px-4 @xl:grid-cols-[minmax(0,1fr)_4.5rem_7rem_8rem_2rem]";

/** Input de la fila principal (cantidad, costo): alto táctil apilado, compacto en escritorio. */
export const purchaseLineInputClassName =
  "h-10 w-full min-w-0 rounded-md border border-border bg-surface px-2 text-sm tabular-nums text-foreground outline-none transition-colors [color-scheme:light] focus:border-primary focus:ring-1 focus:ring-primary/25 dark:[color-scheme:dark] @xl:h-8";
