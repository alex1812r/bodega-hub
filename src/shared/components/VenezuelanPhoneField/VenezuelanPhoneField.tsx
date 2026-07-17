"use client";

import { useId } from "react";

import { SelectField } from "@/shared/components/SelectField";
import {
  formControlClassName,
  formControlErrorClassName,
  formHelperClassName,
  formHelperErrorClassName,
  formLabelClassName,
} from "@/shared/styles/form-controls";
import { cn } from "@/shared/utils/cn";
import {
  VE_MOBILE_PREFIXES,
  composeVeMobilePhone,
  formatSubscriberMask,
  formatVeMobilePhoneDisplay,
  isVeMobilePrefix,
  parseVeMobilePhone,
  type VeMobilePrefix,
} from "@/shared/venezuela/phone";

type VenezuelanPhoneFieldProps = {
  error?: string;
  helperText?: string;
  label?: string;
  onChange: (phoneDigits: string) => void;
  value: string;
};

const DEFAULT_PREFIX: VeMobilePrefix = "0412";

export function VenezuelanPhoneField({
  error,
  helperText = "Formato: 0412 555-1234",
  label = "Telefono",
  onChange,
  value,
}: VenezuelanPhoneFieldProps) {
  const inputId = useId();
  const descriptionId = `${inputId}-description`;
  const parsed = parseVeMobilePhone(value);
  const prefix: VeMobilePrefix = parsed.ok
    ? parsed.value.prefix
    : isVeMobilePrefix(value.replace(/\D/g, "").slice(0, 4))
      ? (value.replace(/\D/g, "").slice(0, 4) as VeMobilePrefix)
      : DEFAULT_PREFIX;
  const subscriberDigits = parsed.ok
    ? parsed.value.subscriber
    : value.replace(/\D/g, "").length > 4
      ? value.replace(/\D/g, "").slice(4, 11)
      : value.replace(/\D/g, "").length > 0 &&
          !isVeMobilePrefix(value.replace(/\D/g, "").slice(0, 4))
        ? value.replace(/\D/g, "").slice(0, 7)
        : "";
  const description =
    error ??
    (subscriberDigits.length > 0
      ? formatVeMobilePhoneDisplay(composeVeMobilePhone(prefix, subscriberDigits))
      : helperText);

  function emit(nextPrefix: VeMobilePrefix, nextSubscriber: string) {
    const digits = nextSubscriber.replace(/\D/g, "").slice(0, 7);
    if (!digits) {
      onChange("");
      return;
    }

    onChange(composeVeMobilePhone(nextPrefix, digits));
  }

  return (
    <div className="space-y-2">
      {label ? (
        <label className={formLabelClassName} htmlFor={inputId}>
          {label}
        </label>
      ) : null}

      <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-2">
        <SelectField
          aria-label="Codigo de area"
          onChange={(event) =>
            emit(event.target.value as VeMobilePrefix, subscriberDigits)
          }
          options={VE_MOBILE_PREFIXES.map((code) => ({
            label: code,
            value: code,
          }))}
          value={prefix}
        />
        <input
          aria-describedby={description ? descriptionId : undefined}
          aria-invalid={error ? true : undefined}
          aria-label="Numero telefonico"
          className={cn(
            formControlClassName,
            error && formControlErrorClassName,
          )}
          id={inputId}
          inputMode="numeric"
          onChange={(event) => {
            const digits = event.target.value.replace(/\D/g, "").slice(0, 7);
            emit(prefix, digits);
          }}
          placeholder="555-1234"
          type="text"
          value={formatSubscriberMask(subscriberDigits)}
        />
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
