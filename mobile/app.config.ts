import type { ExpoConfig } from "expo/config";

/**
 * Configuracion de BodegaHub Mobile.
 *
 * Las variables `EXPO_PUBLIC_*` llegan al bundle; no poner secretos aqui.
 * La anon key de Supabase es publica por diseno (RLS es quien protege).
 */
const config: ExpoConfig = {
  name: "BodegaHub",
  slug: "bodegahub",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: "bodegahub",
  userInterfaceStyle: "automatic",
  android: {
    package: "com.bodegahub.app",
    versionCode: 1,
    adaptiveIcon: {
      backgroundColor: "#4F46E5",
      foregroundImage: "./assets/images/android-icon-foreground.png",
      backgroundImage: "./assets/images/android-icon-background.png",
      monochromeImage: "./assets/images/android-icon-monochrome.png",
    },
    permissions: ["android.permission.CAMERA"],
    predictiveBackGestureEnabled: false,
  },
  ios: {
    bundleIdentifier: "com.bodegahub.app",
    supportsTablet: true,
    infoPlist: {
      NSCameraUsageDescription:
        "BodegaHub usa la camara para escanear codigos de barras y tomar fotos de productos.",
      NSPhotoLibraryUsageDescription:
        "BodegaHub accede a tus fotos para asignar imagenes a los productos.",
    },
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-sharing",
    [
      "expo-splash-screen",
      {
        backgroundColor: "#4F46E5",
        image: "./assets/images/splash-icon.png",
        imageWidth: 96,
      },
    ],
    [
      "expo-camera",
      {
        cameraPermission:
          "BodegaHub usa la camara para escanear codigos de barras y tomar fotos de productos.",
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    router: {},
  },
};

export default config;
