import Link from "next/link";

import { Button } from "@/shared/components/Button";
import { formatRef, formatVes, refToVes } from "@/shared/utils/currency";

export function WelcomePage() {
  const exampleTotalRef = 22;
  const exampleRate = 510;
  const exampleTotalVes = refToVes(exampleTotalRef, exampleRate);

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10 text-slate-950 dark:bg-slate-950 dark:text-slate-100">
      <section className="mx-auto flex max-w-5xl flex-col gap-8">
        <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <p className="text-sm font-medium text-blue-600 dark:text-blue-400">ERP Web</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight">
            Control de ventas, compras, inventario y pagos en ref/VES.
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600 dark:text-slate-400">
            Pantalla inicial de referencia para desarrollo. La entrada principal de la app
            redirige al dashboard o al login segun la sesion.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild>
              <Link href="/login">Iniciar sesion</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/dashboard">Ver dashboard</Link>
            </Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-sm text-slate-500 dark:text-slate-400">Total ref ejemplo</p>
            <p className="mt-2 text-2xl font-semibold">{formatRef(exampleTotalRef)}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-sm text-slate-500 dark:text-slate-400">Tasa VES/ref</p>
            <p className="mt-2 text-2xl font-semibold">{formatVes(exampleRate)}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-sm text-slate-500 dark:text-slate-400">Total VES</p>
            <p className="mt-2 text-2xl font-semibold">{formatVes(exampleTotalVes)}</p>
          </div>
        </div>
      </section>
    </main>
  );
}
