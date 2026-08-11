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
  images: {
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
