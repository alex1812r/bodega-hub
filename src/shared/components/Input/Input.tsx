import { type ComponentPropsWithoutRef, useId } from "react";

import { cn } from "@/shared/utils/cn";

type InputProps = ComponentPropsWithoutRef<"input"> & {
  error?: string;
  helperText?: string;
  label?: string;
};

export function Input({
  className,
  error,
  helperText,
  id,
  label,
  ...props
}: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const descriptionId = `${inputId}-description`;
  const description = error ?? helperText;

  return (
    <div className="space-y-2">
      {label ? (
        <label
          className="text-sm font-medium text-slate-700 dark:text-slate-300"
          htmlFor={inputId}
        >
          {label}
        </label>
      ) : null}
      <input
        aria-describedby={description ? descriptionId : undefined}
        aria-invalid={error ? true : undefined}
        className={cn(
          "h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none transition-colors placeholder:text-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-blue-500 dark:focus:ring-blue-950 dark:disabled:bg-slate-900 dark:disabled:text-slate-500",
          error &&
            "border-red-500 focus:border-red-500 focus:ring-red-100 dark:border-red-500 dark:focus:ring-red-950",
          className,
        )}
        id={inputId}
        {...props}
      />
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
