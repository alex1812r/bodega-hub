"use client";

import { Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import {
  formControlClassName,
  formControlErrorClassName,
  formHelperClassName,
  formHelperErrorClassName,
  formLabelClassName,
} from "@/shared/styles/form-controls";
import { cn } from "@/shared/utils/cn";

export type SearchAutocompleteOption = {
  id: string;
  label: string;
  sublabel?: string;
};

type SearchAutocompleteProps = {
  emptyMessage?: string;
  error?: string;
  helperText?: string;
  isLoading?: boolean;
  label: string;
  minQueryLength?: number;
  onQueryChange: (query: string) => void;
  onSelect: (option: SearchAutocompleteOption) => void;
  options: SearchAutocompleteOption[];
  placeholder: string;
  query: string;
  required?: boolean;
  selectedLabel?: string;
};

export function SearchAutocomplete({
  emptyMessage = "Sin resultados",
  error,
  helperText,
  isLoading = false,
  label,
  minQueryLength = 2,
  onQueryChange,
  onSelect,
  options,
  placeholder,
  query,
  required = false,
  selectedLabel,
}: SearchAutocompleteProps) {
  const inputId = useId();
  const listId = `${inputId}-list`;
  const descriptionId = `${inputId}-description`;
  const containerRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const trimmedQuery = query.trim();
  const hasMinQuery = trimmedQuery.length >= minQueryLength;
  const description = error ?? helperText;
  const displayValue = isOpen ? query : selectedLabel || query;

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  function handleQueryChange(nextQuery: string) {
    onQueryChange(nextQuery);
    setIsOpen(true);
  }

  return (
    <div className="space-y-2" ref={containerRef}>
      <label className={formLabelClassName} htmlFor={inputId}>
        {label}
        {required ? " *" : null}
      </label>
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 z-10 size-[1.125rem] -translate-y-1/2 text-muted-foreground"
        />
        <input
          aria-autocomplete="list"
          aria-controls={isOpen && hasMinQuery ? listId : undefined}
          aria-describedby={description ? descriptionId : undefined}
          aria-expanded={isOpen}
          aria-invalid={error ? true : undefined}
          className={cn(
            formControlClassName,
            "pl-10",
            error && formControlErrorClassName,
          )}
          id={inputId}
          onChange={(event) => handleQueryChange(event.target.value)}
          onFocus={() => setIsOpen(true)}
          placeholder={placeholder}
          role="combobox"
          type="search"
          value={displayValue}
        />

        {isOpen && hasMinQuery && isLoading ? (
          <p className="absolute top-full z-20 mt-1 w-full rounded-lg border border-border bg-surface-container-lowest px-3 py-2 text-sm text-muted-foreground shadow-lg">
            Buscando...
          </p>
        ) : null}

        {isOpen && hasMinQuery && !isLoading && options.length > 0 ? (
          <ul
            className="absolute top-full z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-border bg-surface-container-lowest py-1 shadow-lg dark:border-slate-700"
            id={listId}
            role="listbox"
          >
            {options.map((option) => (
              <li key={option.id} role="option">
                <button
                  className="flex w-full cursor-pointer flex-col px-3 py-2 text-left text-sm transition-colors hover:bg-surface-container-low"
                  onClick={() => {
                    onSelect(option);
                    onQueryChange("");
                    setIsOpen(false);
                  }}
                  type="button"
                >
                  <span className="font-medium text-foreground">{option.label}</span>
                  {option.sublabel ? (
                    <span className="text-xs text-on-surface-variant">{option.sublabel}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {isOpen && hasMinQuery && !isLoading && options.length === 0 ? (
          <p className="absolute top-full z-20 mt-1 w-full rounded-lg border border-border bg-surface-container-lowest px-3 py-2 text-sm text-muted-foreground shadow-lg">
            {emptyMessage}
          </p>
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
