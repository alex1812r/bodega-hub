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
      <section className="hidden flex-1 bg-blue-700 p-10 text-white lg:flex lg:flex-col lg:justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-blue-100">
            Control Ventas
          </p>
          <Typography as="h1" className="mt-6 max-w-xl text-white" variant="display">
            Administra ventas, compras e inventario desde una sola plataforma.
          </Typography>
        </div>

        <div className="grid gap-4 text-sm text-blue-50">
          <p>Precios base en ref con conversion historica a VES.</p>
          <p>Pagos parciales, stock auditable y metricas de ganancia.</p>
        </div>
      </section>

      <section className="flex flex-1 items-center justify-center px-6 py-10">
        <Card className="w-full max-w-md">
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
