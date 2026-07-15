import { type ComponentPropsWithoutRef, type ReactNode, useId } from "react";

import {
  formControlClassName,
  formControlErrorClassName,
  formHelperClassName,
  formHelperErrorClassName,
  formLabelClassName,
} from "@/shared/styles/form-controls";
import { cn } from "@/shared/utils/cn";

type InputProps = ComponentPropsWithoutRef<"input"> & {
  error?: string;
  helperText?: string;
  label?: string;
  trailing?: ReactNode;
};

export function Input({
  className,
  error,
  helperText,
  id,
  label,
  trailing,
  ...props
}: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const descriptionId = `${inputId}-description`;
  const description = error ?? helperText;

  return (
    <div className="space-y-2">
      {label ? (
        <label className={formLabelClassName} htmlFor={inputId}>
          {label}
        </label>
      ) : null}
      <div className={cn(trailing && "relative")}>
        <input
          aria-describedby={description ? descriptionId : undefined}
          aria-invalid={error ? true : undefined}
          className={cn(
            formControlClassName,
            error && formControlErrorClassName,
            trailing && "pr-11",
            className,
          )}
          id={inputId}
          {...props}
        />
        {trailing ? (
          <div className="absolute inset-y-0 right-0 flex items-center pr-1">{trailing}</div>
        ) : null}
      </div>
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
