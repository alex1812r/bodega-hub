import type { EnvironmentContext, JestEnvironmentConfig } from "@jest/environment";
import JSDOMEnvironment from "jest-environment-jsdom";

/**
 * Entorno jsdom con el reloj local en Asia/Tokyo (UTC+9), para probar que las
 * fechas se pintan en el día operativo de Caracas y no en la zona del
 * navegador. Se usa con `@jest-environment` en el docblock de la prueba.
 *
 * `process.env.TZ` dentro de una prueba es una copia: hay que cambiar el del
 * proceso real, y devolverlo al terminar porque el worker ejecuta más pruebas.
 */
export default class TokyoTimezoneEnvironment extends JSDOMEnvironment {
  private readonly originalTimezone = process.env.TZ;

  constructor(config: JestEnvironmentConfig, context: EnvironmentContext) {
    process.env.TZ = "Asia/Tokyo";
    super(config, context);
  }

  async teardown() {
    if (this.originalTimezone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = this.originalTimezone;
    }

    await super.teardown();
  }
}
