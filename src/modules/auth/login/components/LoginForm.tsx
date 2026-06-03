"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { type ComponentPropsWithoutRef } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/shared/components/Button";
import { Input } from "@/shared/components/Input";

import { loginSchema, type LoginFormValues } from "../schemas/loginSchema";

type LoginFormProps = Omit<ComponentPropsWithoutRef<"form">, "onSubmit"> & {
  errorMessage?: string;
  isSubmitting?: boolean;
  onSubmit: (values: LoginFormValues) => void;
};

export function LoginForm({
  errorMessage,
  isSubmitting = false,
  onSubmit,
  ...props
}: LoginFormProps) {
  const {
    formState: { errors },
    handleSubmit,
    register,
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  return (
    <form className="space-y-5" onSubmit={handleSubmit(onSubmit)} {...props}>
      <Input
        autoComplete="email"
        error={errors.email?.message}
        label="Correo"
        placeholder="admin@empresa.com"
        type="email"
        {...register("email")}
      />

      <Input
        autoComplete="current-password"
        error={errors.password?.message}
        label="Clave"
        placeholder="Ingresa tu clave"
        type="password"
        {...register("password")}
      />

      {errorMessage ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorMessage}
        </p>
      ) : null}

      <Button className="w-full" disabled={isSubmitting} type="submit">
        {isSubmitting ? "Entrando..." : "Iniciar sesion"}
      </Button>
    </form>
  );
}
