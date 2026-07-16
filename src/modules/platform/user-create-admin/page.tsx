"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { getPaginatedItems } from "@/lib/api/pagination";
import { Button } from "@/shared/components/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/Card";
import { Input } from "@/shared/components/Input";
import { SelectField } from "@/shared/components/SelectField";
import { Typography } from "@/shared/components/Typography";

import { useStoresList } from "../hooks/useStores";
import { useCreateStoreAdmin } from "../hooks/useUsers";

export function CreateStoreAdminPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const createAdmin = useCreateStoreAdmin();
  const stores = useStoresList({ limit: 100 });
  const storeItems = getPaginatedItems(stores.data);
  const presetStoreId = searchParams.get("storeId") ?? "";

  const [form, setForm] = useState({
    email: "",
    fullName: "",
    password: "",
    storeId: presetStoreId,
  });

  useEffect(() => {
    if (presetStoreId) {
      setForm((current) => ({ ...current, storeId: presetStoreId }));
    }
  }, [presetStoreId]);

  const storeOptions = useMemo(
    () => [
      { label: "Selecciona una tienda", value: "" },
      ...storeItems.map((store) => ({
        label: `${store.name} (/${store.slug})`,
        value: store.id,
      })),
    ],
    [storeItems],
  );

  const update =
    (key: keyof typeof form) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((current) => ({ ...current, [key]: event.target.value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const user = await createAdmin.mutateAsync({
      email: form.email,
      fullName: form.fullName,
      password: form.password,
      storeId: form.storeId,
    });
    router.push(`/platform/users/${user.id}`);
  }

  return (
    <form className="mx-auto max-w-2xl space-y-6" onSubmit={submit}>
      <div>
        <Link className="text-sm text-primary hover:underline" href="/platform/users">
          ← Usuarios
        </Link>
        <Typography as="h1" className="mt-2" variant="h1">
          Nuevo administrador de tienda
        </Typography>
        <Typography className="mt-1" variant="muted">
          El superadmin solo puede crear administradores. Los demas roles los gestiona cada admin
          de tienda.
        </Typography>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Datos del administrador</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <SelectField
            className="sm:col-span-2"
            label="Tienda"
            onChange={update("storeId")}
            options={storeOptions}
            required
            value={form.storeId}
          />
          <Input
            label="Nombre completo"
            onChange={update("fullName")}
            required
            value={form.fullName}
          />
          <Input
            label="Email"
            onChange={update("email")}
            required
            type="email"
            value={form.email}
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

      {createAdmin.error ? (
        <p className="text-sm text-destructive">{createAdmin.error.message}</p>
      ) : null}

      <div className="flex justify-end gap-3">
        <Button asChild type="button" variant="outline">
          <Link href="/platform/users">Cancelar</Link>
        </Button>
        <Button disabled={createAdmin.isPending || !form.storeId} type="submit">
          {createAdmin.isPending ? "Creando..." : "Crear administrador"}
        </Button>
      </div>
    </form>
  );
}
