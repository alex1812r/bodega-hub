"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";

import { cn } from "@/shared/utils/cn";

export type AssistantSource = {
  input: unknown;
  output: unknown;
  state: string;
  toolName: string;
};

type Row = { key: string; value: string };

function formatValue(value: unknown): string {
  if (value == null) {
    return "—";
  }

  if (typeof value === "number") {
    return new Intl.NumberFormat("es-VE", { maximumFractionDigits: 2 }).format(value);
  }

  if (typeof value === "boolean") {
    return value ? "si" : "no";
  }

  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
}

/** Aplana el resultado de la tool a filas clave/valor legibles. */
function toRows(value: unknown, prefix = "", depth = 0): Row[] {
  if (depth > 3) {
    return [{ key: prefix || "valor", value: formatValue(value) }];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) => toRows(item, `${prefix}[${index + 1}]`, depth + 1));
  }

  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) =>
      toRows(entry, prefix ? `${prefix}.${key}` : key, depth + 1),
    );
  }

  return [{ key: prefix || "valor", value: formatValue(value) }];
}

type ToolResult = {
  data?: unknown;
  error?: string;
  note?: string;
  ok?: boolean;
  options?: string[];
  range?: { from: string; to: string };
};

export function AssistantSourceBlock({ source }: { source: AssistantSource }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const output = (source.output ?? {}) as ToolResult;
  const range = output.range ? `${output.range.from} → ${output.range.to}` : null;
  const rows = output.ok === false ? [] : toRows(output.data).slice(0, 60);

  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-border bg-surface-container-low text-xs">
      <button
        aria-controls={panelId}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left font-medium text-slate-600 hover:bg-surface-container dark:text-slate-300"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <ChevronDown
          aria-hidden
          className={cn("size-4 transition-transform", open && "rotate-180")}
        />
        <span>
          Fuente: {source.toolName}
          {range ? ` · ${range}` : ""}
        </span>
      </button>

      {open ? (
        <div className="border-t border-border px-3 py-2" id={panelId}>
          {source.state !== "output-available" ? (
            <p className="text-slate-500 dark:text-slate-400">Consultando…</p>
          ) : output.ok === false ? (
            <p className="text-red-600 dark:text-red-400">{output.error}</p>
          ) : rows.length === 0 ? (
            <p className="text-slate-500 dark:text-slate-400">Sin datos para ese rango.</p>
          ) : (
            <table className="w-full table-fixed border-collapse">
              <tbody>
                {rows.map((row) => (
                  <tr className="border-b border-border/60 last:border-0" key={row.key}>
                    <th
                      className="w-1/2 truncate py-1 pr-2 text-left font-normal text-slate-500 dark:text-slate-400"
                      scope="row"
                      title={row.key}
                    >
                      {row.key}
                    </th>
                    <td className="py-1 text-right tabular-nums text-slate-900 dark:text-slate-100">
                      {row.value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {output.note ? (
            <p className="mt-2 text-slate-500 dark:text-slate-400">{output.note}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
