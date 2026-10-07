"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Suspense,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { cn } from "@/shared/utils/cn";

export type TabItem<TValue extends string = string> = {
  value: TValue;
  label: ReactNode;
  /** Contador o marca corta junto a la etiqueta. */
  badge?: ReactNode;
  disabled?: boolean;
  content: ReactNode;
};

type TabsBaseProps<TValue extends string> = {
  items: readonly TabItem<TValue>[];
  /** Nombre accesible de la barra de pestañas. */
  ariaLabel: string;
  /** Pestaña inicial. Si falta, no existe o está deshabilitada, se usa la primera habilitada. */
  defaultValue?: TValue;
  onValueChange?: (value: TValue) => void;
  className?: string;
  panelClassName?: string;
};

type TabsLocalProps<TValue extends string> = TabsBaseProps<TValue> & {
  /** Modo controlado: la pestaña activa la decide quien usa el componente. */
  value?: TValue;
  urlParam?: undefined;
};

type TabsUrlProps<TValue extends string> = TabsBaseProps<TValue> & {
  /** Parámetro de la URL que guarda la pestaña activa (p. ej. `"tab"`). No se combina con `value`. */
  urlParam: string;
  value?: undefined;
};

export type TabsProps<TValue extends string = string> =
  | TabsLocalProps<TValue>
  | TabsUrlProps<TValue>;

function isSelectable<TValue extends string>(
  items: readonly TabItem<TValue>[],
  value: string | null | undefined,
): value is TValue {
  return items.some((item) => item.value === value && !item.disabled);
}

function resolveFallbackValue<TValue extends string>(
  items: readonly TabItem<TValue>[],
  defaultValue: TValue | undefined,
): TValue | undefined {
  if (isSelectable(items, defaultValue)) {
    return defaultValue;
  }

  return items.find((item) => !item.disabled)?.value;
}

type TabsViewProps<TValue extends string> = {
  items: readonly TabItem<TValue>[];
  ariaLabel: string;
  activeValue: TValue | undefined;
  onSelect?: (value: TValue) => void;
  className?: string;
  panelClassName?: string;
};

function TabsView<TValue extends string>({
  items,
  ariaLabel,
  activeValue,
  onSelect,
  className,
  panelClassName,
}: TabsViewProps<TValue>) {
  const baseId = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabledIndexes = items.flatMap((item, index) => (item.disabled ? [] : [index]));

  function moveTo(index: number | undefined) {
    if (index === undefined) {
      return;
    }

    tabRefs.current[index]?.focus();
    onSelect?.(items[index].value);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const position = enabledIndexes.indexOf(index);
    const count = enabledIndexes.length;

    if (position === -1) {
      return;
    }

    let target: number | undefined;

    if (event.key === "ArrowRight") {
      target = enabledIndexes[(position + 1) % count];
    } else if (event.key === "ArrowLeft") {
      target = enabledIndexes[(position - 1 + count) % count];
    } else if (event.key === "Home") {
      target = enabledIndexes[0];
    } else if (event.key === "End") {
      target = enabledIndexes[count - 1];
    } else {
      return;
    }

    event.preventDefault();
    moveTo(target);
  }

  return (
    <div className={cn("w-full min-w-0", className)}>
      <div
        aria-label={ariaLabel}
        aria-orientation="horizontal"
        className="flex max-w-full overflow-x-auto border-b border-outline-variant"
        role="tablist"
      >
        {items.map((item, index) => {
          const isActive = item.value === activeValue;

          return (
            <button
              aria-controls={`${baseId}-panel-${index}`}
              aria-selected={isActive}
              className={cn(
                "inline-flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
                isActive
                  ? "border-primary font-semibold text-primary"
                  : "border-transparent text-on-surface-variant enabled:hover:bg-surface-container-low",
              )}
              disabled={item.disabled}
              id={`${baseId}-tab-${index}`}
              key={item.value}
              onClick={() => onSelect?.(item.value)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              role="tab"
              tabIndex={isActive ? 0 : -1}
              type="button"
            >
              {item.label}
              {item.badge !== undefined && item.badge !== null ? (
                <span
                  className={cn(
                    "inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-medium",
                    isActive
                      ? "bg-primary-container text-on-primary-container"
                      : "bg-surface-container-high text-on-surface-variant",
                  )}
                >
                  {item.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {items.map((item, index) => {
        const isActive = item.value === activeValue;

        return (
          <div
            aria-labelledby={`${baseId}-tab-${index}`}
            className={cn(
              "pt-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              panelClassName,
            )}
            hidden={!isActive}
            id={`${baseId}-panel-${index}`}
            key={item.value}
            role="tabpanel"
            tabIndex={0}
          >
            {isActive ? item.content : null}
          </div>
        );
      })}
    </div>
  );
}

function LocalTabs<TValue extends string>({
  items,
  ariaLabel,
  defaultValue,
  value,
  onValueChange,
  className,
  panelClassName,
}: TabsLocalProps<TValue>) {
  const fallbackValue = resolveFallbackValue(items, defaultValue);
  const [internalValue, setInternalValue] = useState(fallbackValue);
  const isControlled = value !== undefined;
  const requestedValue = isControlled ? value : internalValue;
  const activeValue = isSelectable(items, requestedValue) ? requestedValue : fallbackValue;

  function handleSelect(nextValue: TValue) {
    if (nextValue === activeValue) {
      return;
    }

    if (!isControlled) {
      setInternalValue(nextValue);
    }

    onValueChange?.(nextValue);
  }

  return (
    <TabsView
      activeValue={activeValue}
      ariaLabel={ariaLabel}
      className={className}
      items={items}
      onSelect={handleSelect}
      panelClassName={panelClassName}
    />
  );
}

/**
 * Único punto que usa los hooks de navegación. `useSearchParams` obliga a un
 * límite de Suspense en el build de rutas prerenderizadas: lo pone `Tabs`.
 */
function UrlTabs<TValue extends string>({
  items,
  ariaLabel,
  defaultValue,
  urlParam,
  onValueChange,
  className,
  panelClassName,
}: TabsUrlProps<TValue>) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlValue = searchParams.get(urlParam);
  const fallbackValue = resolveFallbackValue(items, defaultValue);
  const [selection, setSelection] = useState<{ urlValue: string | null; value: string | null }>({
    urlValue,
    value: urlValue,
  });

  // Si la URL cambia por fuera (enlace, atrás/adelante), manda la URL.
  if (selection.urlValue !== urlValue) {
    setSelection({ urlValue, value: urlValue });
  }

  const requestedValue = selection.urlValue === urlValue ? selection.value : urlValue;
  const activeValue = isSelectable(items, requestedValue) ? requestedValue : fallbackValue;

  function handleSelect(nextValue: TValue) {
    if (nextValue === activeValue) {
      return;
    }

    setSelection({ urlValue, value: nextValue });

    const params = new URLSearchParams(searchParams.toString());

    if (nextValue === fallbackValue) {
      params.delete(urlParam);
    } else {
      params.set(urlParam, nextValue);
    }

    const query = params.toString();

    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    onValueChange?.(nextValue);
  }

  return (
    <TabsView
      activeValue={activeValue}
      ariaLabel={ariaLabel}
      className={className}
      items={items}
      onSelect={handleSelect}
      panelClassName={panelClassName}
    />
  );
}

export function Tabs<TValue extends string = string>(props: TabsProps<TValue>) {
  if (props.urlParam === undefined) {
    return <LocalTabs {...props} />;
  }

  return (
    <Suspense
      fallback={
        <TabsView
          activeValue={resolveFallbackValue(props.items, props.defaultValue)}
          ariaLabel={props.ariaLabel}
          className={props.className}
          items={props.items}
          panelClassName={props.panelClassName}
        />
      }
    >
      <UrlTabs {...props} />
    </Suspense>
  );
}
