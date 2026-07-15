export type ApiDataSource = "mock" | "supabase";

export function resolveDataSource(): ApiDataSource {
  const configured = process.env.API_DATA_SOURCE;

  if (configured === "mock" || configured === "supabase") {
    return configured;
  }

  return process.env.NODE_ENV === "test" ? "mock" : "supabase";
}

export function isSupabaseDataSource() {
  return resolveDataSource() === "supabase";
}

export function isDevToolkitEnabled() {
  return (
    process.env.NODE_ENV === "development" ||
    process.env.ALLOW_DEMO_AUTH === "true" ||
    resolveDataSource() === "mock"
  );
}
