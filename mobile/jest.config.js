/** @type {import('jest').Config} */
module.exports = {
  preset: "jest-expo",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    // El workspace se resuelve por symlink; Jest no lee su campo `exports`.
    "^@bodega/core$": "<rootDir>/../packages/core/src/index.ts",
    "^@bodega/core/(.*)$": "<rootDir>/../packages/core/src/$1",
  },
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "!src/app/**",
    "!src/**/*.d.ts",
    "!src/testIds.ts",
  ],
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|@shopify/flash-list|nativewind|react-native-css-interop))",
  ],
};
