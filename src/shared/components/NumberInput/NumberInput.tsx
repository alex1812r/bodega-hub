"use client";

import {
  type ChangeEvent,
  type ClipboardEvent,
  type ComponentProps,
  type CompositionEvent,
  type FocusEvent,
  type KeyboardEvent,
  type Ref,
  useCallback,
  useEffect,
  useRef,
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
  /**
   * Máximo de decimales; al salir del campo los sobrantes se redondean (medio hacia arriba).
   * `0` = entero: un valor con decimales no se redondea, se deja escrito y el campo queda
   * inválido con su mensaje (salvo que se pase `error`). El formulario debe negarse a enviarlo.
   */
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

type TypedSeparator = "," | ".";

/** Una tecla anunciada por `beforeinput`: el carácter y la selección que va a sustituir. */
type TypedKey = { char: string; end: number; start: number };

const DIGIT = /\d/;
const SEPARATOR = /[.,]/g;
const INTEGER_REQUIRED_MESSAGE = "Debe ser un número entero.";
// Con más dígitos el número deja de ser exacto y acaba saliendo como 1e+21 o Infinity.
const MAX_DIGITS = 15;

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

function hasNonZeroFraction(text: string) {
  return /[1-9]/.test(text.replace(",", ".").split(".")[1] ?? "");
}

/**
 * `true` si el texto del campo es un número sin parte decimal distinta de cero
 * ("3", "3." y "3,0" sí; "2.5", "2,5" y vacío no). Mira los dígitos, no el
 * número, para no dar por entero un decimal que la coma flotante no distingue.
 */
export function isIntegerText(text: string) {
  return parseNumberInput(text) !== null && !hasNonZeroFraction(text);
}

/**
 * Mensaje que muestra el campo para ese texto, o `undefined` si no hay nada que
 * decir. Hoy solo avisa de decimales en un campo entero; el vacío no es un error
 * de formato (si es obligatorio lo decide el formulario).
 */
export function getNumberInputError(text: string, { decimals }: Pick<TextOptions, "decimals"> = {}) {
  return decimals === 0 && parseNumberInput(text) !== null && !isIntegerText(text)
    ? INTEGER_REQUIRED_MESSAGE
    : undefined;
}

/**
 * Limpia lo que se escribe: solo dígitos, un separador decimal (coma o punto,
 * siempre devuelto como punto; los siguientes se ignoran) y, si se permite,
 * un menos inicial. Los decimales sobrantes se conservan (se redondean al salir
 * del campo). Con `decimals: 0` también: descartar el separador uniría los
 * dígitos (2.5 → 25) y cambiaría la cantidad sin avisar.
 * Qué separador queda cuando se teclea un segundo lo decide antes
 * `findTypedDecimalIndex`; aquí llega ya uno solo.
 */
export function sanitizeNumberText(raw: string, { allowNegative }: TextOptions = {}) {
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

  return `${sign}${integerPart}${hasSeparator ? `.${fractionPart}` : ""}`;
}

/**
 * `true` si entre el primer y el último dígito hay algo que no es dígito ni
 * separador ("1e3", "12abc3", "3-4", "10 20"). Limpiar ese texto uniría los
 * dígitos (1e3 → 13) y cambiaría la cantidad sin avisar. Un espacio seguido de
 * exactamente tres dígitos sí vale: son miles ("1 000"). Lo que rodea al número
 * ("Bs 12", " 7 ") no cuenta.
 */
function hasForeignTextBetweenDigits(text: string) {
  const body = /\d(?:[^]*\d)?/.exec(text)?.[0] ?? "";

  return /[^\d.,]/.test(body.replace(/(\d)[   ](?=\d{3}(?!\d))/g, "$1"));
}

function countDigits(text: string) {
  return text.replace(/\D/g, "").length;
}

/**
 * `true` si un mismo separador se repite y no puede ser de miles porque algún
 * grupo no tiene tres dígitos ("1.2.3", "12,,5"). No hay forma de saber qué
 * número es: leerlo como miles daría 123. "1.234.567" sí son miles. Como en
 * `hasForeignTextBetweenDigits`, lo que rodea al número ("Bs. 12") no cuenta.
 */
function hasAmbiguousSeparators(text: string) {
  const body = /\d(?:[^]*\d)?/.exec(text)?.[0] ?? "";
  const groups = body.split(SEPARATOR).slice(1);

  return (
    groups.length > 1 &&
    !(body.includes(",") && body.includes(".")) &&
    groups.some((group) => countDigits(group) !== 3)
  );
}

/** Texto que llega de golpe (pegado, arrastre, dictado) y que no se puede leer como un solo número. */
function isNotPlainNumber(text: string) {
  return hasForeignTextBetweenDigits(text) || hasAmbiguousSeparators(text);
}

/** `true` si `next` añade dígitos por encima de los que un número guarda exactos. Acortar un valor largo sí se deja. */
function exceedsDigits(next: string, previous: string) {
  return countDigits(next) > MAX_DIGITS && countDigits(next) > countDigits(previous);
}

/** Dónde empieza y cuánto mide lo que `raw` tiene de nuevo respecto a `previous`, y cuánto de `previous` ya no está. */
function findInsertion(previous: string, raw: string) {
  const shortest = Math.min(previous.length, raw.length);
  let start = 0;
  let tail = 0;

  while (start < shortest && previous[start] === raw[start]) {
    start += 1;
  }

  while (tail < shortest - start && previous[previous.length - 1 - tail] === raw[raw.length - 1 - tail]) {
    tail += 1;
  }

  return { length: raw.length - start - tail, removed: previous.length - start - tail, start };
}

/**
 * `true` si el cambio es de una sola tecla: borrar, añadir un carácter sin quitar
 * ninguno o la tecla que anunció el navegador sobre su selección. Solo entonces
 * se puede limpiar el texto carácter a carácter. Que la diferencia con el valor
 * anterior mida un carácter no basta: "103" sustituido entero por "1e3" también
 * la mide, y limpiarlo dejaría 13.
 */
function isSingleKeyEdit(previous: string, raw: string, key: TypedKey | null) {
  const insertion = findInsertion(previous, raw);

  return (
    insertion.length === 0 ||
    (insertion.length === 1 && insertion.removed === 0) ||
    (key !== null && raw === previous.slice(0, key.start) + key.char + previous.slice(key.end))
  );
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

/**
 * Posición del separador que queda como decimal en un texto recién tecleado
 * (`caret` va justo después de la tecla), o -1 si no queda ninguno.
 * `shownAs` es el carácter con el que se tecleó el separador que ya estaba.
 * - Uno solo: es el decimal.
 * - Se tecleó uno distinto del que había: como al pegar, el último es el
 *   decimal y el otro son miles ("1.250" + "," → 1250.).
 * - Se tecleó uno igual al que había: la tecla se rechaza y queda el anterior.
 */
function findTypedDecimalIndex(raw: string, caret: number, shownAs: TypedSeparator) {
  const indexes = Array.from(raw.matchAll(SEPARATOR), (match) => match.index);
  const last = indexes[indexes.length - 1] ?? -1;
  const typedIndex = caret - 1;

  if (indexes.length < 2) {
    return last;
  }

  if (indexes.length === 2 && indexes.includes(typedIndex)) {
    const existingIndex = indexes[0] === typedIndex ? indexes[1] : indexes[0];

    return raw[typedIndex] === shownAs ? existingIndex : last;
  }

  // No fue una sola tecla (arrastre, autocompletado): mismas reglas que al pegar.
  return raw.includes(",") && raw.includes(".") ? last : -1;
}

function dropSeparatorsExcept(text: string, keepIndex: number) {
  return text.replace(SEPARATOR, (separator, index: number) => (index === keepIndex ? separator : ""));
}

function numberToText(value: number, { decimals, padDecimals }: NormalizeOptions) {
  if (!Number.isFinite(value)) {
    return "";
  }

  // Un no entero en un campo entero se muestra tal cual: redondearlo enseñaría otro valor que el del padre.
  if (decimals === undefined || (decimals === 0 && !Number.isInteger(value))) {
    return value.toLocaleString("en-US", { maximumFractionDigits: 20, useGrouping: false });
  }

  const fixed = value.toFixed(decimals);
  const text = padDecimals || !fixed.includes(".") ? fixed : fixed.replace(/\.?0+$/, "");

  return Number(text) === 0 ? text.replace("-", "") : text;
}

/**
 * Formato al salir del campo: redondea a `decimals`, después aplica min/max y
 * limpia ceros a la izquierda o un separador suelto. Un valor ya válido se
 * devuelve igual. En un campo entero (`decimals: 0`) un valor con decimales no
 * nulos ni se redondea ni se ajusta a min/max: se queda escrito, inválido.
 */
export function normalizeNumberText(text: string, options: NormalizeOptions = {}) {
  const { allowNegative, decimals, max, min, padDecimals } = options;
  const sanitized = sanitizeNumberText(text, { allowNegative });
  const keepsFraction = decimals === 0 && hasNonZeroFraction(sanitized);
  const clean = keepsFraction ? sanitized : roundNumberText(sanitized, decimals);
  const parsed = parseNumberInput(clean);

  if (parsed === null) {
    return "";
  }

  if (!keepsFraction && min !== undefined && parsed < min) {
    return numberToText(min, options);
  }

  if (!keepsFraction && max !== undefined && parsed > max) {
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
function commitValue(element: HTMLInputElement, next: string, caret?: number) {
  if (element.value === next) {
    return;
  }

  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

  setter?.call(element, next);

  if (caret !== undefined) {
    element.setSelectionRange(caret, caret);
  }

  element.dispatchEvent(new Event("input", { bubbles: true }));
}

export function NumberInput({
  allowArrowStep = false,
  allowNegative = false,
  decimals,
  defaultValue,
  disabled,
  error,
  max,
  min,
  onBlur,
  onChange,
  onCompositionEnd,
  onCompositionStart,
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
  // El DOM siempre lleva punto: aquí se recuerda con qué tecla se escribió el separador actual.
  const typedSeparator = useRef<TypedSeparator>(".");
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Texto del campo justo antes de la edición en curso: a él se vuelve si la edición se rechaza.
  const lastValue = useRef("");
  const isComposing = useRef(false);
  const isWriting = useRef(false);
  // Tecla que el navegador anunció para la edición en curso; `null` si el texto llega de otra forma.
  const typedKey = useRef<TypedKey | null>(null);
  // Texto a medio componer (teclado IME): se muestra tal cual hasta que la composición termina.
  const [composition, setComposition] = useState<string | null>(null);
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
  // Último texto del campo. En modo no controlado arranca en el valor inicial, para validarlo también.
  const [draft, setDraft] = useState(() => (isControlled ? "" : toText(defaultValue)));
  const valueText = toText(value);
  // Mientras lo escrito equivalga al valor del padre se muestra tal cual, para
  // no perder un "1." o un "1.0" a medio escribir cuando el padre guarda números.
  // Se compara con el valor sin formatear: lo tecleado puede llevar decimales de más hasta el blur.
  const valueNumber = typeof value === "number" ? parseNumberInput(value) : parseNumberInput(valueText);
  const displayValue = parseNumberInput(draft) === valueNumber ? draft : valueText;
  // El aviso del llamador manda sobre el del propio campo.
  const shownError = error ?? getNumberInputError(isControlled ? displayValue : draft, { decimals });

  const setRefs = useCallback(
    (node: HTMLInputElement | null) => {
      inputRef.current = node;

      if (typeof ref === "function") {
        return ref(node);
      }

      if (ref) {
        ref.current = node;
      }
    },
    [ref],
  );

  // El valor también cambia sin pasar por `handleChange` (valor inicial o `reset` de react-hook-form,
  // el padre): se anota tras cada render y justo antes de cada edición del usuario.
  useEffect(() => {
    const element = inputRef.current;

    if (!element) {
      return;
    }

    const remember = () => {
      if (!isComposing.current) {
        lastValue.current = element.value;
      }
    };

    const rememberEdit = (event: InputEvent) => {
      const start = element.selectionStart ?? element.value.length;

      remember();
      typedKey.current =
        event.inputType === "insertText" && event.data?.length === 1
          ? { char: event.data, end: element.selectionEnd ?? start, start }
          : null;
    };

    remember();
    element.addEventListener("beforeinput", rememberEdit);

    return () => element.removeEventListener("beforeinput", rememberEdit);
  });

  // Lo que escribe el propio campo (formato al salir, pegado, flechas) lleva siempre punto.
  function writeValue(element: HTMLInputElement, next: string) {
    typedSeparator.current = ".";
    isWriting.current = true;
    commitValue(element, next);
    isWriting.current = false;
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const element = event.currentTarget;
    const raw = element.value;
    const key = typedKey.current;

    typedKey.current = null;

    // Reescribir el campo a media composición hace que el teclado vuelva a insertar todo (12,5 → 1212512.5).
    if (isComposing.current) {
      setComposition(raw);
      return;
    }

    const previous = lastValue.current;
    const rawCaret = element.selectionStart ?? raw.length;
    const decimalIndex = findTypedDecimalIndex(raw, rawCaret, typedSeparator.current);
    const next = sanitizeNumberText(dropSeparatorsExcept(raw, decimalIndex), options);

    // Texto que no llega de una sola tecla ni es pegado (arrastre, autocompletado, dictado, composición,
    // una selección sustituida): misma regla que al pegar, sobre el texto entero. Lo que escribe el
    // propio campo ya viene limpio.
    if (
      !isWriting.current &&
      ((!isSingleKeyEdit(previous, raw, key) && isNotPlainNumber(raw)) || exceedsDigits(next, previous))
    ) {
      const caret = Math.min(findInsertion(previous, raw).start, previous.length);

      element.value = previous;
      element.setSelectionRange(caret, caret);
      lastValue.current = previous;
      return;
    }

    if (decimalIndex < 0) {
      typedSeparator.current = ".";
    } else if (raw[decimalIndex] === "," || decimalIndex === rawCaret - 1) {
      typedSeparator.current = raw[decimalIndex] === "," ? "," : ".";
    }

    if (next !== raw) {
      const typedUntil = dropSeparatorsExcept(raw.slice(0, rawCaret), decimalIndex);
      const caret = Math.min(sanitizeNumberText(typedUntil, options).length, next.length);

      element.value = next;
      element.setSelectionRange(caret, caret);
    }

    lastValue.current = next;
    setDraft(next);
    onChange?.(event);
    onValueChange?.(parseNumberInput(next));
  }

  function handleCompositionStart(event: CompositionEvent<HTMLInputElement>) {
    isComposing.current = true;
    lastValue.current = event.currentTarget.value;
    onCompositionStart?.(event);
  }

  function handleCompositionEnd(event: CompositionEvent<HTMLInputElement>) {
    onCompositionEnd?.(event);

    const element = event.currentTarget;
    const composed = element.value;
    const caret = element.selectionStart ?? composed.length;

    isComposing.current = false;
    setComposition(null);
    // React ya vio el texto compuesto: se vuelve al valor de partida para que lo
    // reciba como un único cambio, una sustitución y no inserciones acumuladas.
    element.value = lastValue.current;
    commitValue(element, composed, caret);
  }

  function handleFocus(event: FocusEvent<HTMLInputElement>) {
    event.currentTarget.select();
    onFocus?.(event);
  }

  function handleBlur(event: FocusEvent<HTMLInputElement>) {
    if (!readOnly) {
      writeValue(event.currentTarget, normalizeNumberText(event.currentTarget.value, options));
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
    const pasted = event.clipboardData.getData("text");

    // Se mira junto a lo que ya había: pegar "e3" detrás de "1" también daría 13. El campo se queda como estaba.
    if (isNotPlainNumber(current.slice(0, start) + pasted + current.slice(end))) {
      return;
    }

    const head =current.slice(0, start) + normalizePastedNumber(pasted);
    const next = sanitizeNumberText(head + current.slice(end), options);

    if (exceedsDigits(next, current)) {
      return;
    }
    const caret = Math.min(sanitizeNumberText(head, options).length, next.length);

    writeValue(element, next);
    element.setSelectionRange(caret, caret);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    onKeyDown?.(event);

    // Enter envía el formulario sin pasar por blur: se normaliza antes para no enviar sin redondear.
    if (event.key === "Enter" && !event.defaultPrevented && !readOnly) {
      writeValue(event.currentTarget, normalizeNumberText(event.currentTarget.value, options));
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

    writeValue(element, normalizeNumberText(String(Number(next.toFixed(precision))), options));
  }

  // `Input` reenvía sus props al <input>, `ref` incluido, aunque su tipo no lo declare.
  const inputProps = {
    ...props,
    disabled,
    error: shownError,
    // Los teclados numéricos del móvil no traen el signo menos.
    inputMode: allowNegative ? ("text" as const) : decimals === 0 ? ("numeric" as const) : ("decimal" as const),
    onBlur: handleBlur,
    onChange: handleChange,
    onCompositionEnd: handleCompositionEnd,
    onCompositionStart: handleCompositionStart,
    onFocus: handleFocus,
    onKeyDown: handleKeyDown,
    onPaste: handlePaste,
    readOnly,
    ref: setRefs,
    type: "text" as const,
    ...(isControlled
      ? { value: composition ?? displayValue }
      : { defaultValue: defaultValue === undefined ? undefined : toText(defaultValue) }),
  };

  return <Input {...inputProps} />;
}
