import { cn } from "@/shared/utils/cn";

type RememberedFiltersChipProps = {
  /** "Limpiar": normalmente `clear` de `useRememberedListFilters`. */
  onClear: () => void;
  className?: string;
};

/**
 * Aviso de que la lista se abrió con los filtros de la última visita, con la
 * acción para quitarlos. Se pinta mientras `useRememberedListFilters().restored`
 * sea `true`.
 */
export function RememberedFiltersChip({ className, onClear }: RememberedFiltersChipProps) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full bg-indigo-50 py-0.5 pl-2.5 pr-1 text-xs font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
        className,
      )}
      role="status"
    >
      <span>Filtros recordados</span>{" "}
      <span aria-hidden>·</span>{" "}
      <button
        className="cursor-pointer rounded-full px-1.5 py-1 font-semibold underline underline-offset-2 hover:bg-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-indigo-900"
        onClick={onClear}
        type="button"
      >
        Limpiar
      </button>
    </span>
  );
}
