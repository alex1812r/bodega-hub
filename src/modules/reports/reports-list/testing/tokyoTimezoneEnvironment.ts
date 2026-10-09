import type { EnvironmentContext, JestEnvironmentConfig } from "@jest/environment";
import JSDOMEnvironment from "jest-environment-jsdom";

/**
 * Entorno jsdom con el reloj local en Asia/Tokyo (UTC+9), para probar que las
 * fechas se pintan en el día operativo de Caracas y no en la zona del
 * navegador. Se usa con `@jest-environment` en el docblock de la prueba.
 *
 * `process.env.TZ` dentro de una prueba es una copia: hay que cambiar el del
 * proceso real, y devolverlo al terminar porque el worker ejecuta más pruebas.
 *
 * La zona anterior se lee ANTES de cambiarla (un inicializador de campo corre
 * después de `super()`, o sea ya en Tokio) y se repone con su nombre: en Node
 * `delete process.env.TZ` no devuelve el reloj a la zona del sistema, y la
 * siguiente suite del worker pintaría las fechas un día corridas.
 */
export default class TokyoTimezoneEnvironment extends JSDOMEnvironment {
  private readonly originalTimezone: string;

  constructor(config: JestEnvironmentConfig, context: EnvironmentContext) {
    const originalTimezone = process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    process.env.TZ = "Asia/Tokyo";
    super(config, context);
    this.originalTimezone = originalTimezone;
  }

  async teardown() {
    process.env.TZ = this.originalTimezone;

    await super.teardown();
  }
}
