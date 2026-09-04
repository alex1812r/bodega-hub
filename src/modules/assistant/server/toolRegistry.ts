import { tool, type Tool } from "ai";
import type { ZodType } from "zod";

import { failFromError } from "./tools/_shared";

import type { AssistantToolContext, AssistantToolResult, AssistantToolScope } from "../types";

type AnyResult = AssistantToolResult<unknown>;

export type AssistantToolDefinition<TInput = unknown> = {
  /** Ejemplos de preguntas que la disparan; se inyectan en la descripcion. */
  examples: string[];
  description: string;
  execute: (input: TInput, ctx: AssistantToolContext) => Promise<AnyResult> | AnyResult;
  inputSchema: ZodType<TInput>;
  name: string;
  scope: AssistantToolScope;
};

const registry = new Map<string, AssistantToolDefinition<never>>();

export function registerTool<TInput>(definition: AssistantToolDefinition<TInput>) {
  if (registry.has(definition.name)) {
    throw new Error(`La herramienta "${definition.name}" ya esta registrada.`);
  }

  registry.set(definition.name, definition as unknown as AssistantToolDefinition<never>);

  return definition;
}

export function listToolDefinitions() {
  return [...registry.values()];
}

/** Solo para tests: limpia el registro entre importaciones dinamicas. */
export function clearToolRegistry() {
  registry.clear();
}

function buildDescription(definition: AssistantToolDefinition<never>) {
  if (definition.examples.length === 0) {
    return definition.description;
  }

  const examples = definition.examples.map((example) => `"${example}"`).join(", ");

  return `${definition.description}\nPreguntas que la disparan: ${examples}.`;
}

/**
 * Herramientas visibles para el contexto. Un admin nunca ve las de plataforma
 * y un superadmin nunca ve las de tienda: son conjuntos disjuntos.
 */
export function toolsForContext(ctx: AssistantToolContext): Record<string, Tool> {
  const entries = listToolDefinitions()
    .filter((definition) => definition.scope === ctx.scope)
    .map((definition) => [
      definition.name,
      tool({
        description: buildDescription(definition),
        inputSchema: definition.inputSchema,
        execute: async (input: never) => {
          try {
            return await definition.execute(input, ctx);
          } catch (error) {
            return failFromError(
              error,
              `No se pudo consultar ${definition.name}. Intenta de nuevo.`,
            );
          }
        },
      }),
    ]);

  return Object.fromEntries(entries) as Record<string, Tool>;
}
