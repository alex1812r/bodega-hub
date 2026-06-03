"use client";



import { Filter } from "lucide-react";

import { type ReactNode, useState } from "react";



import { Button } from "@/shared/components/Button";

import { IconButton } from "@/shared/components/IconButton";



type FilterPanelProps = {

  children: ReactNode;

  defaultOpen?: boolean;

  title?: string;

};



export function FilterPanel({

  children,

  defaultOpen = false,

  title = "Filtros",

}: FilterPanelProps) {

  const [isOpen, setIsOpen] = useState(defaultOpen);



  return (

    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">

      <div className="flex items-center justify-between gap-3">

        <div>

          <h2 className="text-sm font-semibold text-slate-950 dark:text-slate-100">

            {title}

          </h2>

          <p className="text-xs text-slate-500 dark:text-slate-400">

            Refina el listado con criterios simples.

          </p>

        </div>



        <IconButton

          aria-label={isOpen ? "Ocultar filtros" : "Mostrar filtros"}

          icon={<Filter className="h-4 w-4" />}

          onClick={() => setIsOpen((current) => !current)}

        />

      </div>



      {isOpen ? (

        <div className="mt-4 grid grid-cols-1 gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2 lg:grid-cols-3 dark:border-slate-800">

          {children}

          <div className="flex flex-col gap-2 sm:col-span-2 sm:flex-row sm:items-end lg:col-span-1">

            <Button className="w-full sm:w-auto" size="sm" type="button">

              Aplicar

            </Button>

            <Button className="w-full sm:w-auto" size="sm" type="button" variant="outline">

              Limpiar

            </Button>

          </div>

        </div>

      ) : null}

    </section>

  );

}

