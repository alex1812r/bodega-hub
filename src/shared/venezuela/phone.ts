export const VE_MOBILE_PREFIXES = [
  "0412",
  "0422",
  "0414",
  "0424",
  "0416",
  "0426",
] as const;

export type VeMobilePrefix = (typeof VE_MOBILE_PREFIXES)[number];

export type ParsedVeMobilePhone = {
  prefix: VeMobilePrefix;
  subscriber: string;
};

export function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

export function isVeMobilePrefix(value: string): value is VeMobilePrefix {
  return (VE_MOBILE_PREFIXES as readonly string[]).includes(value);
}

export function formatSubscriberMask(subscriberDigits: string) {
  const digits = digitsOnly(subscriberDigits).slice(0, 7);
  if (digits.length <= 3) {
    return digits;
  }

  return `${digits.slice(0, 3)}-${digits.slice(3)}`;
}

export function composeVeMobilePhone(prefix: string, subscriberDigits: string) {
  const subscriber = digitsOnly(subscriberDigits).slice(0, 7);
  return `${prefix}${subscriber}`;
}

export function formatVeMobilePhoneDisplay(raw: string) {
  const parsed = parseVeMobilePhone(raw);
  if (!parsed.ok) {
    const digits = digitsOnly(raw);
    if (digits.length <= 4) {
      return digits;
    }

    return `${digits.slice(0, 4)} ${formatSubscriberMask(digits.slice(4))}`;
  }

  return `${parsed.value.prefix} ${formatSubscriberMask(parsed.value.subscriber)}`;
}

export type ParseVeMobilePhoneResult =
  | { ok: true; value: ParsedVeMobilePhone }
  | { ok: false; error: string };

export function parseVeMobilePhone(raw: string): ParseVeMobilePhoneResult {
  const digits = digitsOnly(raw);

  if (!digits) {
    return { ok: false, error: "Indica el telefono." };
  }

  if (digits.length !== 11) {
    return {
      ok: false,
      error: "El telefono debe tener 11 digitos (prefijo + 7 digitos).",
    };
  }

  const prefix = digits.slice(0, 4);
  const subscriber = digits.slice(4);

  if (!isVeMobilePrefix(prefix)) {
    return {
      ok: false,
      error: "Usa un prefijo valido: 0412, 0422, 0414, 0424, 0416 o 0426.",
    };
  }

  if (subscriber.length !== 7) {
    return {
      ok: false,
      error: "El numero debe tener 7 digitos despues del prefijo.",
    };
  }

  return {
    ok: true,
    value: { prefix, subscriber },
  };
}

export function isValidVeMobilePhone(raw: string) {
  return parseVeMobilePhone(raw).ok;
}
