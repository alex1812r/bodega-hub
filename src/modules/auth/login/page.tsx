"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/components/Card";
import { Typography } from "@/shared/components/Typography";

import { LoginForm } from "./components/LoginForm";
import { useLogin } from "./hooks/useLogin";

export function LoginPage() {
  const login = useLogin();
  const errorMessage =
    login.error instanceof Error ? login.error.message : undefined;

  return (
    <main className="flex min-h-screen bg-slate-50 dark:bg-slate-950">
      <section className="hidden flex-1 bg-indigo-700 p-10 text-white lg:flex lg:flex-col lg:justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-indigo-100">
            BodegaSync
          </p>
          <p className="mt-2 text-sm text-indigo-200">Control de Ventas ERP</p>
          <Typography as="h1" className="mt-6 max-w-xl text-white" variant="display">
            Administra ventas, compras e inventario desde una sola plataforma.
          </Typography>
        </div>

        <div className="grid gap-4 text-sm text-indigo-50">
          <p>Precios base en ref con conversion historica a VES.</p>
          <p>Pagos parciales, stock auditable y metricas de ganancia.</p>
        </div>
      </section>

      <section className="flex flex-1 flex-col items-center justify-center px-6 py-10">
        <div className="mb-8 text-center lg:hidden">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-xl bg-indigo-600 shadow-sm">
            <span className="text-2xl font-bold text-white">B</span>
          </div>
          <p className="text-lg font-semibold tracking-tight text-indigo-700 dark:text-indigo-400">
            BodegaSync
          </p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Control de Ventas ERP
          </p>
        </div>

        <Card className="w-full max-w-md shadow-[0_8px_12px_-4px_rgba(11,28,48,0.08)]">
          <CardHeader>
            <CardTitle>Iniciar sesion</CardTitle>
            <CardDescription>
              Ingresa con tu usuario para acceder al ERP.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LoginForm
              errorMessage={errorMessage}
              isSubmitting={login.isPending}
              onSubmit={(values) => login.mutate(values)}
            />
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
