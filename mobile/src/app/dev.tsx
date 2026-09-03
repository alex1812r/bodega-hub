import { useRouter } from "expo-router";
import { ScrollView, StyleSheet } from "react-native";

import { getApiBaseUrl, hasSupabaseCredentials, isDemoAuthEnabled } from "@/api/config";
import { useAuth } from "@/auth/AuthContext";
import { testIds } from "@/testIds";
import { spacing } from "@/theme/tokens";
import { Button, Card, Screen, Text } from "@/ui";

const demoRoles = ["admin", "vendedor", "almacen", "contador", "superadmin"] as const;

/**
 * Pantalla oculta de desarrollo (5 toques en el logo del login). Invisible en
 * release: sin `EXPO_PUBLIC_ALLOW_DEMO_AUTH=true` no hace nada.
 */
export default function DevScreen() {
  const { setDemoAuth, demoAuth } = useAuth();
  const router = useRouter();

  if (!isDemoAuthEnabled()) {
    return (
      <Screen title="Desarrollo">
        <Text tone="muted">El modo demo esta desactivado en este build.</Text>
      </Screen>
    );
  }

  return (
    <Screen title="Desarrollo">
      <ScrollView contentContainerStyle={styles.content} testID={testIds.dev.screen}>
        <Card>
          <Text variant="label" tone="muted">
            Backend
          </Text>
          <Text variant="caption">{getApiBaseUrl()}</Text>
          <Text tone="muted" variant="caption">
            Supabase: {hasSupabaseCredentials() ? "configurado" : "sin credenciales (modo mock)"}
          </Text>
        </Card>

        <Card>
          <Text variant="label" tone="muted">
            Rol demo {demoAuth?.role ? `(actual: ${demoAuth.role})` : ""}
          </Text>
          {demoRoles.map((role) => (
            <Button
              key={role}
              onPress={() => {
                void setDemoAuth({ role });
                router.replace("/");
              }}
              testID={testIds.dev.role(role)}
              title={role}
              variant={demoAuth?.role === role ? "primary" : "secondary"}
            />
          ))}
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.lg,
    paddingBottom: spacing.xxl,
  },
});
