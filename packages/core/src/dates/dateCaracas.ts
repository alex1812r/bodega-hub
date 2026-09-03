/** Fecha en zona America/Caracas como clave `YYYY-MM-DD`. */
export function toAmericaCaracasDateKey(iso: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Caracas" }).format(
    new Date(iso),
  );
}
