import { toErrorResponse } from "@/lib/api/apiError";
import { jsonData } from "@/lib/api/jsonResponse";
import {
  getAssistantUsage,
  resolveAssistantContext,
} from "@/modules/assistant/server/session";

export async function GET(request: Request) {
  try {
    const ctx = await resolveAssistantContext(request);

    return jsonData(await getAssistantUsage(ctx));
  } catch (error) {
    return toErrorResponse(error);
  }
}
