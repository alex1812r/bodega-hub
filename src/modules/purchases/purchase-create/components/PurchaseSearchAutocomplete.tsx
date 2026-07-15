"use client";

import { Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { cn } from "@/shared/utils/cn";

import {
  purchaseFormInputClassName,
  purchaseFormLabelClassName,
} from "../utils/purchaseCreateStyles";

export type PurchaseSearchOption = {
  id: string;
  label: string;
  sublabel?: string;
};

type PurchaseSearchAutocompleteProps = {
  label: string;
  onQueryChange: (query: string) => void;
  onSelect: (option: PurchaseSearchOption) => void;
  options: PurchaseSearchOption[];
  placeholder: string;
  query: string;
  required?: boolean;
  selectedLabel?: string;
};

export function PurchaseSearchAutocomplete({
  label,
  onQueryChange,
  onSelect,
  options,
  placeholder,
  query,
  required = false,
  selectedLabel,
}: PurchaseSearchAutocompleteProps) {
  const listId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const displayValue = isOpen ? query : selectedLabel || query;

  return (
    <div className="relative" ref={containerRef}>
      <label className={purchaseFormLabelClassName} htmlFor={listId}>
        {label}
        {required ? " *" : ""}
      </label>
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-[1.125rem] -translate-y-1/2 text-muted-foreground"
        />
        <input
          aria-autocomplete="list"
          aria-controls={isOpen && options.length > 0 ? `${listId}-list` : undefined}
          aria-expanded={isOpen}
          className={cn(purchaseFormInputClassName, "pl-10")}
          id={listId}
          onChange={(event) => {
            onQueryChange(event.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          placeholder={placeholder}
          role="combobox"
          type="search"
          value={displayValue}
        />
      </div>

      {isOpen && options.length > 0 ? (
        <ul
          className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-border bg-surface-container-lowest py-1 shadow-lg dark:border-slate-700"
          id={`${listId}-list`}
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

      {isOpen && query.trim() && options.length === 0 ? (
        <p className="absolute z-20 mt-1 w-full rounded-lg border border-border bg-surface-container-lowest px-3 py-2 text-sm text-muted-foreground shadow-lg">
          Sin resultados
        </p>
      ) : null}
    </div>
  );
}
