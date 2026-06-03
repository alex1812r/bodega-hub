import { type ComponentPropsWithoutRef, useId } from "react";

import { cn } from "@/shared/utils/cn";

type SelectOption = {
  label: string;
  value: string;
};

type SelectFieldProps = ComponentPropsWithoutRef<"select"> & {
  error?: string;
  helperText?: string;
  label?: string;
  options: SelectOption[];
  placeholder?: string;
};

export function SelectField({
  className,
  error,
  helperText,
  id,
  label,
  options,
  placeholder,
  ...props
}: SelectFieldProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const description = error ?? helperText;
  const descriptionId = `${selectId}-description`;

  return (
    <div className="space-y-2">
      {label ? (
        <label
          className="text-sm font-medium text-slate-700 dark:text-slate-300"
          htmlFor={selectId}
        >
          {label}
        </label>
      ) : null}
      <select
        aria-describedby={description ? descriptionId : undefined}
        aria-invalid={error ? true : undefined}
        className={cn(
          "h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none transition-colors focus:border-blue-600 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-blue-500 dark:focus:ring-blue-950 dark:disabled:bg-slate-900 dark:disabled:text-slate-500",
          error &&
            "border-red-500 focus:border-red-500 focus:ring-red-100 dark:border-red-500 dark:focus:ring-red-950",
          className,
        )}
        id={selectId}
        {...props}
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {description ? (
        <p
          className={cn(
            "text-xs text-slate-500 dark:text-slate-400",
            error && "text-red-600 dark:text-red-400",
          )}
          id={descriptionId}
        >
          {description}
        </p>
      ) : null}
    </div>
  );
}
