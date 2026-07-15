import { type ComponentPropsWithoutRef, useId } from "react";

import {
  formControlErrorClassName,
  formHelperClassName,
  formHelperErrorClassName,
  formLabelClassName,
  formTextareaClassName,
} from "@/shared/styles/form-controls";
import { cn } from "@/shared/utils/cn";

type TextareaProps = ComponentPropsWithoutRef<"textarea"> & {
  error?: string;
  helperText?: string;
  label?: string;
};

export function Textarea({
  className,
  error,
  helperText,
  id,
  label,
  ...props
}: TextareaProps) {
  const generatedId = useId();
  const textareaId = id ?? generatedId;
  const description = error ?? helperText;
  const descriptionId = `${textareaId}-description`;

  return (
    <div className="space-y-2">
      {label ? (
        <label className={formLabelClassName} htmlFor={textareaId}>
          {label}
        </label>
      ) : null}
      <textarea
        aria-describedby={description ? descriptionId : undefined}
        aria-invalid={error ? true : undefined}
        className={cn(
          formTextareaClassName,
          error && formControlErrorClassName,
          className,
        )}
        id={textareaId}
        {...props}
      />
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
