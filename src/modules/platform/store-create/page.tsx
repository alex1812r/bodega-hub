"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/shared/components/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/Card";
import { Input } from "@/shared/components/Input";
import { Textarea } from "@/shared/components/Textarea";
import { Typography } from "@/shared/components/Typography";

import { useCreateStore } from "../hooks/useStores";

export function StoreCreatePage() {
  const router = useRouter();
  const createStore = useCreateStore();
  const [form, setForm] = useState({
    adminEmail: "",
    adminName: "",
    name: "",
    notes: "",
    password: "",
    slug: "",
    status: "active" as const,
  });

  const update =
    (key: keyof typeof form) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((current) => ({ ...current, [key]: event.target.value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const store = await createStore.mutateAsync({
      admin: {
        email: form.adminEmail,
        fullName: form.adminName,
        password: form.password,
      },
      name: form.name,
      notes: form.notes || undefined,
      slug: form.slug,
      status: form.status,
    });
    router.push(`/platform/stores/${store.id}`);
  }

  return (
    <form className="mx-auto max-w-3xl space-y-6" onSubmit={submit}>
      <div>
        <Typography as="h1" variant="h1">
          Crear nueva tienda
        </Typography>
        <Typography className="mt-1" variant="muted">
          Ingresa los datos iniciales y configura el acceso del administrador principal.
        </Typography>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Informacion del negocio</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Input label="Nombre comercial" onChange={update("name")} required value={form.name} />
          <Input
            helperText="Minusculas, numeros y guiones."
            label="Slug"
            onChange={update("slug")}
            required
            value={form.slug}
          />
          <Textarea
            className="sm:col-span-2"
            label="Notas internas (opcional)"
            onChange={update("notes")}
            value={form.notes}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Administrador responsable</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Nombre completo"
            onChange={update("adminName")}
            required
            value={form.adminName}
          />
          <Input
            label="Email"
            onChange={update("adminEmail")}
            required
            type="email"
            value={form.adminEmail}
          />
          <Input
            className="sm:col-span-2"
            helperText="Minimo 8 caracteres."
            label="Contrasena temporal"
            minLength={8}
            onChange={update("password")}
            required
            type="password"
            value={form.password}
          />
        </CardContent>
      </Card>

      {createStore.error ? (
        <p className="text-sm text-destructive">{createStore.error.message}</p>
      ) : null}

      <div className="flex justify-end gap-3">
        <Button asChild type="button" variant="outline">
          <Link href="/platform/stores">Cancelar</Link>
        </Button>
        <Button disabled={createStore.isPending} type="submit">
          {createStore.isPending ? "Creando..." : "Crear tienda"}
        </Button>
      </div>
    </form>
  );
}
