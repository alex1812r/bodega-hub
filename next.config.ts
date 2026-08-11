import type { NextConfig } from "next";

const supabaseHostname = (() => {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) {
    return "*.supabase.co";
  }

  try {
    return new URL(raw).hostname;
  } catch {
    return "*.supabase.co";
  }
})();

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        hostname: supabaseHostname,
        pathname: "/storage/v1/object/public/product-images/**",
        protocol: "https",
      },
      // Fallback for local/preview if env hostname differs from production assets
      {
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/product-images/**",
        protocol: "https",
      },
    ],
  },
};

export default nextConfig;
