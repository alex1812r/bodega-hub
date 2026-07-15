import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        hostname: "**.supabase.co",
        pathname: "/storage/v1/object/public/product-images/**",
        protocol: "https",
      },
    ],
  },
};

export default nextConfig;
