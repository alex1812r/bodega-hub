/** @jest-environment node */
/**
 * STK-616 · M2 del auditor final: `e2e:bodegon` escribe ventas, compras y pagos
 * por el BFF y no tenía ninguna guarda de destino. Solo puede correr contra un
 * entorno local (Supabase y BFF en loopback).
 *
 * Sin red y sin leer `.env*`: la guarda recibe el entorno ya cargado.
 */
import { assertLocalWriteTarget } from "./guard";

const LOCAL_SUPABASE = "http://127.0.0.1:54321";
const REMOTE_SUPABASE = "https://abcdefghijklmnopqrst.supabase.co";

describe("M2 · guarda de destino de e2e-bodegon", () => {
  it("pasa con Supabase en loopback y la URL del BFF por defecto", () => {
    expect(assertLocalWriteTarget({ NEXT_PUBLIC_SUPABASE_URL: LOCAL_SUPABASE })).toEqual({
      baseUrl: "http://localhost:3000",
      apiHost: "localhost",
      supabaseHost: "127.0.0.1",
    });
  });

  it("pasa con Supabase y BFF en loopback declarados", () => {
    expect(
      assertLocalWriteTarget({
        NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
        SMOKE_API_BASE_URL: "http://127.0.0.1:3000/",
      }),
    ).toEqual({ baseUrl: "http://127.0.0.1:3000", apiHost: "127.0.0.1", supabaseHost: "localhost" });
  });

  it.each([
    ["un proyecto de Supabase remoto", REMOTE_SUPABASE],
    ["un host que empieza por localhost", "http://localhost.evil.example:54321"],
    ["userinfo que parece loopback", "http://127.0.0.1:54321@evil.example"],
    ["userinfo delante del loopback", "http://evil.example@127.0.0.1:54321"],
    ["otro esquema", "postgresql://127.0.0.1:54321"],
    ["una URL malformada", "no-es-url"],
    ["una URL vacía", ""],
  ])("aborta si el Supabase del entorno es %s", (_caso, supabaseUrl) => {
    expect(() => assertLocalWriteTarget({ NEXT_PUBLIC_SUPABASE_URL: supabaseUrl })).toThrow(/solo para entornos locales/);
  });

  it("aborta si el entorno no define NEXT_PUBLIC_SUPABASE_URL", () => {
    expect(() => assertLocalWriteTarget({})).toThrow(/solo para entornos locales/);
  });

  it.each([
    ["un host remoto", "https://bodega.example.com"],
    ["un host remoto en el puerto local", "http://evil.example:3000"],
    ["userinfo que parece loopback", "http://localhost:3000@evil.example"],
    ["una URL malformada", "localhost:3000"],
  ])("aborta si SMOKE_API_BASE_URL es %s", (_caso, baseUrl) => {
    expect(() =>
      assertLocalWriteTarget({ NEXT_PUBLIC_SUPABASE_URL: LOCAL_SUPABASE, SMOKE_API_BASE_URL: baseUrl }),
    ).toThrow(/solo para entornos locales/);
  });

  it("aborta si los archivos .env apuntan a un Supabase remoto aunque el shell declare loopback", () => {
    expect(() =>
      assertLocalWriteTarget({ NEXT_PUBLIC_SUPABASE_URL: LOCAL_SUPABASE }, { NEXT_PUBLIC_SUPABASE_URL: REMOTE_SUPABASE }),
    ).toThrow(/solo para entornos locales/);
    expect(
      assertLocalWriteTarget({ NEXT_PUBLIC_SUPABASE_URL: LOCAL_SUPABASE }, { NEXT_PUBLIC_SUPABASE_URL: LOCAL_SUPABASE })
        .supabaseHost,
    ).toBe("127.0.0.1");
  });

  it("no hay variable de escape", () => {
    expect(() =>
      assertLocalWriteTarget({
        NEXT_PUBLIC_SUPABASE_URL: REMOTE_SUPABASE,
        E2E_ALLOW_REMOTE: "true",
        ALLOW_REMOTE_WRITES: "1",
        FORCE: "1",
      }),
    ).toThrow(/solo para entornos locales/);
  });

  it("el mensaje nombra solo el host, nunca el valor completo de la variable", () => {
    const attempt = () =>
      assertLocalWriteTarget({ NEXT_PUBLIC_SUPABASE_URL: "https://usuario:clave-secreta@abc.supabase.co/ruta?token=t0k3n" });
    expect(attempt).toThrow(/abc\.supabase\.co/);
    expect(attempt).not.toThrow(/clave-secreta|t0k3n|ruta/);
  });
});
