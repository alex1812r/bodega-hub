import { toSpanishAuthMessage } from "./session";

describe("toSpanishAuthMessage", () => {
  it.each([
    ["Invalid login credentials", "Correo o contrasena incorrectos."],
    ["Email not confirmed", "Debes confirmar tu correo antes de ingresar."],
    ["Request rate limit reached", "Demasiados intentos. Espera un momento y vuelve a intentar."],
    ["Network request failed", "No hay conexion con el servidor."],
  ])("translates %s", (input, expected) => {
    expect(toSpanishAuthMessage(input)).toBe(expected);
  });

  it("falls back to a generic Spanish message, never the English one", () => {
    const message = toSpanishAuthMessage("Some unexpected upstream failure");

    expect(message).toBe("No se pudo iniciar sesion. Intenta de nuevo.");
    expect(message).not.toMatch(/[a-z]+ failure/i);
  });
});
