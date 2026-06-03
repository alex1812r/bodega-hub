import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { toErrorResponse } from "@/lib/api/apiError";

export async function GET() {
  try {
    const openApi = await readFile(join(process.cwd(), "public", "openapi.yml"), "utf8");

    return new Response(openApi, {
      headers: {
        "content-type": "application/yaml; charset=utf-8",
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
