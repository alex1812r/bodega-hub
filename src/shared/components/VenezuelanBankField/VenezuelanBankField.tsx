"use client";

import { useMemo, useState } from "react";

import { SearchAutocomplete } from "@/shared/components/SearchAutocomplete";
import {
  filterBanks,
  findBankByLabel,
  type VenezuelanBank,
} from "@/shared/venezuela/banks";

type VenezuelanBankFieldProps = {
  error?: string;
  helperText?: string;
  label?: string;
  onChange: (bankLabel: string) => void;
  required?: boolean;
  value: string;
};

export function VenezuelanBankField({
  error,
  helperText,
  label = "Banco",
  onChange,
  required = false,
  value,
}: VenezuelanBankFieldProps) {
  const selectedBank = findBankByLabel(value);
  const selectedLabel = selectedBank?.label ?? (value.trim() || undefined);
  const [query, setQuery] = useState("");

  const options = useMemo(() => {
    return filterBanks(query).map((bank: VenezuelanBank) => ({
      id: bank.code,
      label: bank.label,
      sublabel: bank.code,
    }));
  }, [query]);

  return (
    <SearchAutocomplete
      emptyMessage="No se encontro ese banco."
      error={error}
      helperText={helperText}
      label={label}
      minQueryLength={1}
      onQueryChange={setQuery}
      onSelect={(option) => {
        onChange(option.label);
        setQuery("");
      }}
      options={options}
      placeholder="Buscar por codigo o nombre (ej. 0134 o Banesco)"
      query={query}
      required={required}
      selectedLabel={selectedLabel}
    />
  );
}
