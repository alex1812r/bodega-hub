import { type ComponentPropsWithoutRef, useId } from "react";

import {
  formControlClassName,
  formControlErrorClassName,
  formHelperClassName,
  formHelperErrorClassName,
  formLabelClassName,
} from "@/shared/styles/form-controls";
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
        <label className={formLabelClassName} htmlFor={selectId}>
          {label}
        </label>
      ) : null}
      <select
        aria-describedby={description ? descriptionId : undefined}
        aria-invalid={error ? true : undefined}
        className={cn(
          formControlClassName,
          error && formControlErrorClassName,
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
            formHelperClassName,
            error && formHelperErrorClassName,
          )}
          id={descriptionId}
        >
          {description}
        </p>
      ) : null}
    </div>
  );
}
