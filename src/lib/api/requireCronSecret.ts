import { ApiError } from "@/lib/api/apiError";

export function requireCronSecret(request: Request) {
  const expected = process.env.CRON_SECRET?.trim();

  if (!expected) {
    throw new ApiError(503, "INTERNAL_ERROR", "CRON_SECRET no esta configurado.");
  }

  const authorization = request.headers.get("authorization");
  const bearer = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const headerSecret = request.headers.get("x-cron-secret")?.trim() ?? "";
  const provided = bearer || headerSecret;

  if (!provided || provided !== expected) {
    throw new ApiError(401, "UNAUTHORIZED", "Cron no autorizado.");
  }
}
