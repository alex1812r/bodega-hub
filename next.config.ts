import type { NextConfig } from "next";

function getSupabaseImageHostname() {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) {
    return null;
  }

  try {
    return new URL(raw.replace(/\\r\\n$/g, "").trim()).hostname;
  } catch {
    return null;
  }
}

const supabaseHostname = getSupabaseImageHostname();

const nextConfig: NextConfig = {
  // El AI SDK v7 se publica solo como ESM; transpilarlo permite que Jest
  // (via next/jest) tambien lo cargue en los tests de las rutas.
  transpilePackages: [
    // @bodega/core se consume como fuente TypeScript (sin build), asi que Next
    // tiene que transpilarlo igual que hace con el AI SDK.
    "@bodega/core",
    "ai",
    "@ai-sdk/anthropic",
    "@ai-sdk/mcp",
    "@ai-sdk/gateway",
    "@ai-sdk/google",
    "@ai-sdk/provider",
    "@ai-sdk/provider-utils",
    "@ai-sdk/react",
    "@standard-schema/spec",
    "@workflow/serde",
    "eventsource-parser",
  ],
  images: {
    // Cache del optimizador de Next para covers de productos (segundos).
    minimumCacheTTL: 60 * 60 * 24,
    remotePatterns: [
      ...(supabaseHostname
        ? [
            {
              hostname: supabaseHostname,
              pathname: "/storage/v1/object/public/product-images/**",
              protocol: "https" as const,
            },
          ]
        : []),
    ],
  },
};

export default nextConfig;
