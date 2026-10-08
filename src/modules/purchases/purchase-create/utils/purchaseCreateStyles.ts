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
 * producto · cantidad · costo · total · acciones (candado y quitar) en una sola fila.
 *
 * Cantidad, Costo, Total y acciones tienen ancho fijo (380 px) y el producto se queda
 * con el resto: tarjeta − 32 px de relleno − 32 px de separaciones − 380 px. En una
 * tarjeta de 619 px (viewport de 1280 px) son 175 px, así que entre 36rem y 48rem la
 * línea editable saca SKU y chips a una fila propia (`purchaseLineMetaRowClassName`).
 */
export const purchaseLineGridClassName =
  "grid grid-cols-3 items-center gap-x-3 gap-y-2 px-4 @xl:grid-cols-[minmax(0,1fr)_4.5rem_7rem_8rem_4.25rem] @xl:gap-x-2";

/**
 * Celda Producto de la línea editable (nombre + fila de SKU y chips). Entre 36rem y
 * 48rem se disuelve (`contents`): el nombre ocupa la columna Producto y la fila de SKU
 * y chips pasa a ser una fila de la rejilla. Desde 48rem la columna mide 324 px o más y
 * vuelve a ser una celda con las dos filas dentro.
 */
export const purchaseLineProductCellClassName =
  "col-span-2 min-w-0 @xl:contents @3xl:col-span-1 @3xl:block";

/**
 * Fila de SKU y chips (IVA, Empaque). Apilada puede partirse en dos; entre 36rem y
 * 48rem va en la segunda fila de la rejilla a todo el ancho de la tarjeta, sin pisar
 * Cantidad, Costo ni Total; desde 48rem, bajo el nombre dentro de la celda Producto.
 */
export const purchaseLineMetaRowClassName =
  "mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 @xl:col-span-full @xl:row-start-2 @xl:mt-0 @xl:flex-nowrap @3xl:mt-0.5";

/** Input de la fila principal (cantidad, costo): alto táctil apilado, compacto en escritorio. */
export const purchaseLineInputClassName =
  "h-10 w-full min-w-0 rounded-md border border-border bg-surface px-2 text-sm tabular-nums text-foreground outline-none transition-colors [color-scheme:light] focus:border-primary focus:ring-1 focus:ring-primary/25 dark:[color-scheme:dark] @xl:h-8";
