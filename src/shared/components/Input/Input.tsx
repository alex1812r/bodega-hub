import { type ComponentPropsWithoutRef, type ReactNode, useId } from "react";

import {
  formControlClassName,
  formControlErrorClassName,
  formControlNoticeClassName,
  formHelperClassName,
  formHelperErrorClassName,
  formLabelClassName,
  formNoticeClassName,
} from "@/shared/styles/form-controls";
import { cn } from "@/shared/utils/cn";

import { FloatingFieldNotice } from "./FloatingFieldNotice";

type InputProps = ComponentPropsWithoutRef<"input"> & {
  error?: string;
  helperText?: string;
  label?: string;
  /**
   * Aviso NO bloqueante bajo el campo, en tono de advertencia y anunciado como
   * `role="status"`. No sustituye a `error` ni marca el campo como inválido.
   */
  notice?: string;
  /**
   * `floating`: el aviso se ancla al campo sin ocupar sitio, para no mover la
   * fila de una tabla, y como un tooltip solo se ve con el foco o el puntero en
   * el campo. Por defecto va en el flujo, como `helperText`.
   */
  noticePlacement?: "floating" | "inline";
  trailing?: ReactNode;
};

export function Input({
  className,
  error,
  helperText,
  id,
  label,
  notice,
  noticePlacement = "inline",
  trailing,
  ...props
}: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const descriptionId = `${inputId}-description`;
  const noticeId = `${inputId}-notice`;
  const description = error ?? helperText;
  const describedBy = [description ? descriptionId : null, notice ? noticeId : null]
    .filter(Boolean)
    .join(" ");
  const floatingNotice = noticePlacement === "floating";

  return (
    <div className="space-y-2">
      {label ? (
        <label className={formLabelClassName} htmlFor={inputId}>
          {label}
        </label>
      ) : null}
      <div className={cn(trailing && "relative")}>
        <input
          aria-describedby={describedBy || undefined}
          aria-invalid={error ? true : undefined}
          className={cn(
            formControlClassName,
            error ? formControlErrorClassName : notice && formControlNoticeClassName,
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
      {notice && floatingNotice ? (
        <FloatingFieldNotice anchorId={inputId} id={noticeId}>
          {notice}
        </FloatingFieldNotice>
      ) : null}
      {notice && !floatingNotice ? (
        <p
          aria-live="polite"
          className={formNoticeClassName}
          data-placement="inline"
          id={noticeId}
          role="status"
        >
          {notice}
        </p>
      ) : null}
    </div>
  );
}
