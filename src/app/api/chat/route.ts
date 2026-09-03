import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { z } from "zod";

import { ApiError, toErrorResponse } from "@/lib/api/apiError";
import { createAssistantModel } from "@/modules/assistant/server/provider";
import {
  assertUnderDailyLimit,
  getAssistantUsage,
  logAssistantQuery,
  resolveAssistantContext,
} from "@/modules/assistant/server/session";
import { buildSystemPrompt } from "@/modules/assistant/server/systemPrompt";
import { toolsForContext } from "@/modules/assistant/server/tools";

export const maxDuration = 60;

/** Cuantos mensajes del historial se envian al modelo. */
const HISTORY_LIMIT = 10;
const PROVIDER_TIMEOUT_MS = 45_000;
const MAX_STEPS = 5;

/**
 * Solo aceptamos `user` y `assistant`: un `system` inyectado desde el cliente
 * podria reescribir las reglas del asistente.
 */
const messageSchema = z.object({
  id: z.string().optional(),
  parts: z
    .array(
      z
        .object({ text: z.string().optional(), type: z.string() })
        .loose(),
    )
    .min(1),
  role: z.enum(["assistant", "user"]),
});

type ChatMessage = z.infer<typeof messageSchema>;

/**
 * Del historial que manda el cliente solo sobrevive el texto. Un `parts` con un
 * `tool-*` fabricado seria un resultado de herramienta falso para el modelo:
 * las herramientas se vuelven a ejecutar en el servidor si hacen falta.
 */
function sanitizeMessages(messages: ChatMessage[]) {
  return messages
    .map((message) => ({
      ...message,
      parts: message.parts.filter(
        (part) => part.type === "text" && typeof part.text === "string",
      ),
    }))
    .filter((message) => message.parts.length > 0);
}

const bodySchema = z.object({
  messages: z.array(messageSchema).min(1).max(200),
});

function messageText(message: z.infer<typeof messageSchema>) {
  return message.parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join(" ")
    .trim();
}

const PROVIDER_ERROR_MESSAGE =
  "El servicio de IA no esta disponible en este momento. Intenta de nuevo en unos minutos.";

export async function POST(request: Request) {
  const startedAt = Date.now();

  try {
    const ctx = await resolveAssistantContext(request);
    const usage = await getAssistantUsage(ctx);
    assertUnderDailyLimit(usage);

    const body = bodySchema.parse(await request.json());
    const history = sanitizeMessages(body.messages).slice(-HISTORY_LIMIT);

    if (history.length === 0) {
      throw new ApiError(400, "BAD_REQUEST", "La consulta no tiene texto.");
    }

    const question = messageText(history.at(-1)!);
    const tools = toolsForContext(ctx);

    const result = streamText({
      abortSignal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      messages: await convertToModelMessages(history as unknown as UIMessage[]),
      model: createAssistantModel().model,
      stopWhen: stepCountIs(MAX_STEPS),
      system: buildSystemPrompt({
        scope: ctx.scope,
        storeName: ctx.storeName,
        today: ctx.today,
        toolNames: Object.keys(tools),
      }),
      temperature: 0,
      tools,
      onFinish: async (event) => {
        await logAssistantQuery(ctx, {
          durationMs: Date.now() - startedAt,
          inputTokens: event.totalUsage?.inputTokens ?? null,
          outputTokens: event.totalUsage?.outputTokens ?? null,
          question,
          role: ctx.role,
          storeId: ctx.scope === "store" ? (ctx.storeIds[0] ?? null) : null,
          tools: event.steps.flatMap((step) =>
            step.toolCalls.map((call) => ({ input: call.input, name: call.toolName })),
          ),
          userId: ctx.userId,
        });
      },
      onError: ({ error }) => {
        console.error("[assistant] error del proveedor", error);
      },
    });

    return createUIMessageStreamResponse({
      stream: toUIMessageStream({
        onError: () => PROVIDER_ERROR_MESSAGE,
        stream: result.stream,
        tools,
      }),
    });
  } catch (error) {
    if (error instanceof ApiError || error instanceof z.ZodError) {
      return toErrorResponse(error);
    }

    console.error("[assistant] fallo al iniciar el chat", error);

    return toErrorResponse(
      new ApiError(502, "ASSISTANT_PROVIDER_ERROR", PROVIDER_ERROR_MESSAGE),
    );
  }
}
