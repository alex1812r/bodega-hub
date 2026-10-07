"use client";

import {
  type ChangeEvent,
  type ClipboardEvent,
  type ComponentProps,
  type FocusEvent,
  type KeyboardEvent,
  type Ref,
  useState,
} from "react";

import { Input } from "@/shared/components/Input";

type NumberInputValue = number | string | null;
type NumericLimit = number | string;

export type NumberInputProps = Omit<
  ComponentProps<typeof Input>,
  "defaultValue" | "inputMode" | "max" | "min" | "step" | "type" | "value"
> & {
  /** Con `step`, las flechas arriba/abajo suman o restan. Por defecto no hacen nada. */
  allowArrowStep?: boolean;
  /** Permite el signo menos al inicio. Por defecto no. */
  allowNegative?: boolean;
  /** Máximo de decimales; al salir del campo los sobrantes se redondean (medio hacia arriba). `0` = entero. */
  decimals?: number;
  /** Modo no controlado (el de `register` de react-hook-form). */
  defaultValue?: NumberInputValue;
  /** Se aplica al salir del campo. */
  max?: NumericLimit;
  /** Se aplica al salir del campo. */
  min?: NumericLimit;
  /** Recibe el número ya interpretado, o `null` si el campo está vacío. */
  onValueChange?: (value: number | null) => void;
  /** Al salir, completa con ceros hasta `decimals` (12.5 → 12.50). */
  padDecimals?: boolean;
  ref?: Ref<HTMLInputElement>;
  /** Solo se usa junto con `allowArrowStep`. */
  step?: NumericLimit;
  /** Modo controlado: número, texto con punto o coma, o `null` para vacío. */
  value?: NumberInputValue;
};

type TextOptions = {
  allowNegative?: boolean;
  decimals?: number;
};

type NormalizeOptions = TextOptions & {
  max?: number;
  min?: number;
  padDecimals?: boolean;
};

const DIGIT = /\d/;

/**
 * Interpreta el texto del campo. Sirve como `setValueAs` de `register`:
 * devuelve `null` para vacío en vez del `NaN` de `valueAsNumber`.
 */
export function parseNumberInput(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const text = value.trim().replace(",", ".");

  if (!DIGIT.test(text)) {
    return null;
  }

  const parsed = Number(text);

  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Limpia lo que se escribe: solo dígitos, un separador decimal (coma o punto,
 * siempre devuelto como punto; los siguientes se ignoran) y, si se permite,
 * un menos inicial. Los decimales sobrantes se conservan (se redondean al salir
 * del campo); con `decimals: 0` el separador se rechaza.
 */
export function sanitizeNumberText(raw: string, { allowNegative, decimals }: TextOptions = {}) {
  const sign = allowNegative && raw.trimStart().startsWith("-") ? "-" : "";
  let integerPart = "";
  let fractionPart = "";
  let hasSeparator = false;

  for (const char of raw) {
    if (DIGIT.test(char)) {
      if (hasSeparator) {
        fractionPart += char;
      } else {
        integerPart += char;
      }
    } else if (char === "." || char === ",") {
      hasSeparator = true;
    }
  }

  if (decimals === 0) {
    return `${sign}${integerPart}`;
  }

  return `${sign}${integerPart}${hasSeparator ? `.${fractionPart}` : ""}`;
}

function incrementDigits(digits: string) {
  const chars = digits.split("");
  let index = chars.length - 1;

  while (index >= 0 && chars[index] === "9") {
    chars[index] = "0";
    index -= 1;
  }

  if (index < 0) {
    return `1${chars.join("")}`;
  }

  chars[index] = String(Number(chars[index]) + 1);

  return chars.join("");
}

/**
 * Redondea un texto ya limpio a `decimals`, medio hacia arriba (hacia +∞, como
 * el `Math.round` de `roundMoney`). Opera sobre los dígitos para no arrastrar
 * errores de coma flotante ("1.005" → "1.01"). Si no sobran decimales devuelve
 * el texto igual.
 */
function roundNumberText(text: string, decimals: number | undefined) {
  const negative = text.startsWith("-");
  const [integerRaw = "", fractionRaw = ""] = text.replace("-", "").split(".");

  if (decimals === undefined || fractionRaw.length <= decimals) {
    return text;
  }

  const rest = fractionRaw.slice(decimals);
  const overHalf = rest[0] > "5" || (rest[0] === "5" && /[1-9]/.test(rest.slice(1)));
  const roundsUp = negative ? overHalf : rest[0] >= "5";
  const kept = `${integerRaw || "0"}${fractionRaw.slice(0, decimals)}`;
  const digits = roundsUp ? incrementDigits(kept) : kept;
  const integerPart = digits.slice(0, digits.length - decimals);
  const fractionPart = digits.slice(digits.length - decimals).replace(/0+$/, "");

  return `${negative ? "-" : ""}${integerPart}${fractionPart ? `.${fractionPart}` : ""}`;
}

/**
 * Convierte un texto pegado a formato con punto decimal:
 * - con coma y punto, el último que aparece es el decimal y el otro son miles
 *   ("1.234,50" y "1,234.50" → "1234.50");
 * - un mismo separador repetido son miles ("1.234.567" → "1234567");
 * - un único separador es siempre el decimal ("1.234" → "1.234").
 */
export function normalizePastedNumber(text: string) {
  const cleaned = text.replace(/[^\d.,-]/g, "");
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let decimalIndex = -1;

  if (lastComma >= 0 && lastDot >= 0) {
    decimalIndex = Math.max(lastComma, lastDot);
  } else {
    const lastSeparator = Math.max(lastComma, lastDot);
    const isSingle = lastSeparator >= 0 && cleaned.search(/[.,]/) === lastSeparator;

    decimalIndex = isSingle ? lastSeparator : -1;
  }

  let result = "";

  for (let index = 0; index < cleaned.length; index += 1) {
    const char = cleaned[index];

    if (index === decimalIndex) {
      result += ".";
    } else if (char !== "." && char !== ",") {
      result += char;
    }
  }

  return result;
}

function numberToText(value: number, { decimals, padDecimals }: NormalizeOptions) {
  if (!Number.isFinite(value)) {
    return "";
  }

  if (decimals === undefined) {
    return value.toLocaleString("en-US", { maximumFractionDigits: 20, useGrouping: false });
  }

  const fixed = value.toFixed(decimals);
  const text = padDecimals || !fixed.includes(".") ? fixed : fixed.replace(/\.?0+$/, "");

  return Number(text) === 0 ? text.replace("-", "") : text;
}

/**
 * Formato al salir del campo: redondea a `decimals`, después aplica min/max y
 * limpia ceros a la izquierda o un separador suelto. Un valor ya válido se
 * devuelve igual.
 */
export function normalizeNumberText(text: string, options: NormalizeOptions = {}) {
  const { allowNegative, decimals, max, min, padDecimals } = options;
  const clean = roundNumberText(sanitizeNumberText(text, { allowNegative }), decimals);
  const parsed = parseNumberInput(clean);

  if (parsed === null) {
    return "";
  }

  if (min !== undefined && parsed < min) {
    return numberToText(min, options);
  }

  if (max !== undefined && parsed > max) {
    return numberToText(max, options);
  }

  const [integerRaw = "", fractionRaw = ""] = clean.replace("-", "").split(".");
  const integerPart = integerRaw.replace(/^0+(?=\d)/, "") || "0";
  const fractionPart = padDecimals && decimals ? fractionRaw.padEnd(decimals, "0") : fractionRaw;
  const sign = clean.startsWith("-") && parsed !== 0 ? "-" : "";

  return `${sign}${integerPart}${fractionPart ? `.${fractionPart}` : ""}`;
}

function toLimit(limit: NumericLimit | undefined) {
  return parseNumberInput(limit) ?? undefined;
}

function fractionLength(text: string) {
  return (text.split(".")[1] ?? "").length;
}

/** Escribe en el campo y avisa a React (y a react-hook-form) con un evento nativo. */
function commitValue(element: HTMLInputElement, next: string) {
  if (element.value === next) {
    return;
  }

  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

  setter?.call(element, next);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

export function NumberInput({
  allowArrowStep = false,
  allowNegative = false,
  decimals,
  defaultValue,
  disabled,
  max,
  min,
  onBlur,
  onChange,
  onFocus,
  onKeyDown,
  onPaste,
  onValueChange,
  padDecimals = false,
  readOnly,
  ref,
  step,
  value,
  ...props
}: NumberInputProps) {
  const [draft, setDraft] = useState("");
  const minLimit = toLimit(min);
  const options: NormalizeOptions = {
    allowNegative,
    decimals,
    max: toLimit(max),
    // Sin `allowNegative` el campo no puede bajar de cero aunque no se pase `min`.
    min: allowNegative ? minLimit : Math.max(minLimit ?? 0, 0),
    padDecimals,
  };
  const stepValue = toLimit(step);

  const toText = (input: NumberInputValue | undefined) => {
    if (input === null || input === undefined) {
      return "";
    }

    return typeof input === "number"
      ? numberToText(input, options)
      : sanitizeNumberText(input, options);
  };

  const isControlled = value !== undefined;
  const valueText = toText(value);
  // Mientras lo escrito equivalga al valor del padre se muestra tal cual, para
  // no perder un "1." o un "1.0" a medio escribir cuando el padre guarda números.
  // Se compara con el valor sin formatear: lo tecleado puede llevar decimales de más hasta el blur.
  const valueNumber = typeof value === "number" ? parseNumberInput(value) : parseNumberInput(valueText);
  const displayValue = parseNumberInput(draft) === valueNumber ? draft : valueText;

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const element = event.currentTarget;
    const raw = element.value;
    const next = sanitizeNumberText(raw, options);

    if (next !== raw) {
      const typedUntil = raw.slice(0, element.selectionStart ?? raw.length);
      const caret = Math.min(sanitizeNumberText(typedUntil, options).length, next.length);

      element.value = next;
      element.setSelectionRange(caret, caret);
    }

    setDraft(next);
    onChange?.(event);
    onValueChange?.(parseNumberInput(next));
  }

  function handleFocus(event: FocusEvent<HTMLInputElement>) {
    event.currentTarget.select();
    onFocus?.(event);
  }

  function handleBlur(event: FocusEvent<HTMLInputElement>) {
    if (!readOnly) {
      commitValue(event.currentTarget, normalizeNumberText(event.currentTarget.value, options));
    }

    onBlur?.(event);
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    onPaste?.(event);

    if (event.defaultPrevented || readOnly || disabled) {
      return;
    }

    event.preventDefault();

    const element = event.currentTarget;
    const current = element.value;
    const start = element.selectionStart ?? current.length;
    const end = element.selectionEnd ?? start;
    const head = current.slice(0, start) + normalizePastedNumber(event.clipboardData.getData("text"));
    // Un entero no puede mostrar decimales ni a medias: lo pegado se redondea ya.
    const clean = (text: string) =>
      decimals === 0
        ? roundNumberText(sanitizeNumberText(text, { allowNegative }), 0)
        : sanitizeNumberText(text, options);
    const next = clean(head + current.slice(end));
    const caret = Math.min(clean(head).length, next.length);

    commitValue(element, next);
    element.setSelectionRange(caret, caret);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    onKeyDown?.(event);

    // Enter envía el formulario sin pasar por blur: se normaliza antes para no enviar sin redondear.
    if (event.key === "Enter" && !event.defaultPrevented && !readOnly) {
      commitValue(event.currentTarget, normalizeNumberText(event.currentTarget.value, options));
      return;
    }

    const isArrow = event.key === "ArrowUp" || event.key === "ArrowDown";

    if (event.defaultPrevented || !isArrow || !allowArrowStep || !stepValue || readOnly) {
      return;
    }

    event.preventDefault();

    const element = event.currentTarget;
    const precision =
      decimals ?? Math.max(fractionLength(String(stepValue)), fractionLength(element.value));
    const current = parseNumberInput(element.value) ?? 0;
    const stepped = current + (event.key === "ArrowUp" ? stepValue : -stepValue);
    const next = Math.min(Math.max(stepped, options.min ?? -Infinity), options.max ?? Infinity);

    commitValue(element, normalizeNumberText(String(Number(next.toFixed(precision))), options));
  }

  // `Input` reenvía sus props al <input>, `ref` incluido, aunque su tipo no lo declare.
  const inputProps = {
    ...props,
    disabled,
    // Los teclados numéricos del móvil no traen el signo menos.
    inputMode: allowNegative ? ("text" as const) : decimals === 0 ? ("numeric" as const) : ("decimal" as const),
    onBlur: handleBlur,
    onChange: handleChange,
    onFocus: handleFocus,
    onKeyDown: handleKeyDown,
    onPaste: handlePaste,
    readOnly,
    ref,
    type: "text" as const,
    ...(isControlled
      ? { value: displayValue }
      : { defaultValue: defaultValue === undefined ? undefined : toText(defaultValue) }),
  };

  return <Input {...inputProps} />;
}
