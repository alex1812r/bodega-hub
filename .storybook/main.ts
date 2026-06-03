import type { StorybookConfig } from "@storybook/nextjs-vite";
import { mergeConfig } from "vite";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(js|jsx|mjs|ts|tsx)"],
  addons: [
    "@chromatic-com/storybook",
    "@storybook/addon-vitest",
    "@storybook/addon-a11y",
    "@storybook/addon-docs",
    "@storybook/addon-mcp"
  ],
  framework: "@storybook/nextjs-vite",
  staticDirs: ["../public"],
  viteFinal: async (config) =>
    mergeConfig(config, {
      optimizeDeps: {
        include: [
          "@supabase/supabase-js",
          "@hookform/resolvers/zod",
          "moment",
          "next/link",
          "next/navigation",
          "react-dom",
          "react-hook-form",
          "zod",
        ],
      },
    }),
};
export default config;