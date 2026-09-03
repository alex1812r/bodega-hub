import { ScrollView, StyleSheet } from "react-native";

import { useAuth } from "@/auth/AuthContext";
import { useTheme } from "@/theme/ThemeContext";
import { spacing } from "@/theme/tokens";
import { Button, Card, Screen, Text } from "@/ui";

export default function MasScreen() {
  const { profile, signOutSession } = useAuth();
  const { preference, setPreference } = useTheme();

  const next = preference === "light" ? "dark" : preference === "dark" ? "system" : "light";
  const label: Record<typeof preference, string> = {
    light: "Claro",
    dark: "Oscuro",
    system: "Del sistema",
  };

  return (
    <Screen title="Mas">
      <ScrollView contentContainerStyle={styles.content}>
        <Card>
          <Text variant="label" tone="muted">
            Cuenta
          </Text>
          <Text>{profile?.user.name ?? "-"}</Text>
          <Text tone="muted" variant="caption">
            {profile?.user.email ?? ""}
          </Text>
        </Card>

        <Card>
          <Text variant="label" tone="muted">
            Tema
          </Text>
          <Button
            onPress={() => setPreference(next)}
            title={`Tema: ${label[preference]}`}
            variant="secondary"
          />
        </Card>

        <Button
          onPress={() => void signOutSession()}
          title="Cerrar sesion"
          variant="danger"
        />
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
