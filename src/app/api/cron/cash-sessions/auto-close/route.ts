import { toErrorResponse } from "@/lib/api/apiError";
import { resolveDataSource } from "@/lib/api/dataSource";
import { jsonData } from "@/lib/api/jsonResponse";
import { requireCronSecret } from "@/lib/api/requireCronSecret";
import * as mock from "@/modules/cash/services/cash.session.mock-server";
import * as server from "@/modules/cash/services/cash.session.server";

async function handle(request: Request) {
  try {
    requireCronSecret(request);
    const result =
      resolveDataSource() === "supabase"
        ? await server.autoCloseStaleCashSessions()
        : mock.autoCloseStaleCashSessions();
    return jsonData(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
