import { cn } from "@/shared/utils/cn";

export type ReportChipOption<TValue extends string | number> = {
  label: string;
  value: TValue;
};

type ReportChipGroupProps<TValue extends string | number> = {
  /** Nombre del grupo: se ve delante de los chips y lo lee el lector de pantalla. */
  label: string;
  onChange: (value: TValue) => void;
  options: readonly ReportChipOption<TValue>[];
  /** Valor activo; si no coincide con ninguna opción, ningún chip sale pulsado. */
  value: TValue | undefined;
};

/**
 * Opciones excluyentes de un reporte como chips (`aria-pressed`): el mismo
 * control que «Agrupar por». Los chips saltan de línea en pantallas estrechas.
 */
export function ReportChipGroup<TValue extends string | number>({
  label,
  onChange,
  options,
  value,
}: ReportChipGroupProps<TValue>) {
  return (
    <div aria-label={label} className="flex min-w-0 flex-wrap items-center gap-2" role="group">
      <span aria-hidden className="text-sm font-medium text-on-surface">
        {label}
      </span>
      {options.map((option) => {
        const isActive = option.value === value;

        return (
          <button
            aria-pressed={isActive}
            className={cn(
              "inline-flex h-8 cursor-pointer items-center rounded-full border px-3 text-xs font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
              isActive
                ? "border-primary bg-primary/10 text-on-surface"
                : "border-outline bg-surface-container-lowest text-on-surface hover:bg-surface-container-low",
            )}
            key={String(option.value)}
            onClick={() => onChange(option.value)}
            type="button"
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
