import type { AssistantQueryLogInput } from "../types";

type LoggedQuery = AssistantQueryLogInput & { createdAt: string; day: string };

/** Memoria por proceso: suficiente para dev, tests y e2e. */
const queries: LoggedQuery[] = [];

export function countQueriesForDay(userId: string, day: string) {
  return queries.filter((query) => query.userId === userId && query.day === day).length;
}

export function logQuery(input: AssistantQueryLogInput, day: string) {
  queries.push({ ...input, createdAt: new Date().toISOString(), day });
}

export function listQueries() {
  return [...queries];
}

export function resetQueries() {
  queries.length = 0;
}
