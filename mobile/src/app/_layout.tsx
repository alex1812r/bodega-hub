import { QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, type ReactNode } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { createQueryClient } from "@/api/queryClient";
import { AuthProvider, useAuth } from "@/auth/AuthContext";
import { isPlatformRole } from "@/auth/roleTabs";
import { ThemeProvider, useTheme } from "@/theme/ThemeContext";

void SplashScreen.preventAutoHideAsync();

/** Manda a login, a la tienda o a la plataforma segun la sesion restaurada. */
function AuthGate({ children }: { children: ReactNode }) {
  const { status, profile } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (status === "loading") {
      return;
    }

    void SplashScreen.hideAsync();

    const group = segments[0];
    const inAuthGroup = group === "(auth)";

    if (status === "unauthenticated" && !inAuthGroup) {
      router.replace("/login");
      return;
    }

    if (status === "authenticated" && profile) {
      const target = isPlatformRole(profile.role) ? "/(platform)/inicio" : "/(store)/inicio";
      const inPlatform = group === "(platform)";
      const inStore = group === "(store)";

      if (inAuthGroup || (!inPlatform && !inStore)) {
        router.replace(target);
        return;
      }

      // Un rol de tienda nunca debe quedarse en el grupo de plataforma.
      if (inPlatform && !isPlatformRole(profile.role)) {
        router.replace("/(store)/inicio");
      }

      if (inStore && isPlatformRole(profile.role)) {
        router.replace("/(platform)/inicio");
      }
    }
  }, [status, profile, segments, router]);

  return <>{children}</>;
}

function ThemedStack() {
  const { theme } = useTheme();

  return (
    <>
      <StatusBar style={theme.name === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.appSurface },
        }}
      />
    </>
  );
}

export default function RootLayout() {
  const queryClient = useMemo(() => createQueryClient(), []);

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <AuthProvider>
            <AuthGate>
              <ThemedStack />
            </AuthGate>
          </AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
