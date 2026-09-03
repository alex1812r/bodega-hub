import { ActivityIndicator, StyleSheet, View } from "react-native";

import { testIds } from "@/testIds";
import { useTheme } from "@/theme/ThemeContext";
import { spacing } from "@/theme/tokens";

import { Button } from "./Button";
import { Text } from "./Text";

/**
 * Los cinco estados obligatorios de la seccion 6 del plan. Toda pantalla debe
 * poder mostrarlos: cargando, vacio, error con reintentar, 403 y sin conexion.
 */

export function LoadingState({ label = "Cargando..." }: { label?: string }) {
  const { theme } = useTheme();

  return (
    <View style={styles.centered} testID={testIds.state.loading}>
      <ActivityIndicator color={theme.primary} size="large" />
      <Text tone="muted">{label}</Text>
    </View>
  );
}

export function EmptyState({
  title = "No hay nada aqui todavia",
  description,
}: {
  title?: string;
  description?: string;
}) {
  return (
    <View style={styles.centered} testID={testIds.state.empty}>
      <Text variant="heading">{title}</Text>
      {description ? (
        <Text tone="muted" style={styles.centeredText}>
          {description}
        </Text>
      ) : null}
    </View>
  );
}

export function ErrorState({
  title = "Algo salio mal",
  description = "No pudimos cargar la informacion.",
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <View style={styles.centered} testID={testIds.state.error}>
      <Text variant="heading">{title}</Text>
      <Text tone="muted" style={styles.centeredText}>
        {description}
      </Text>
      {onRetry ? (
        <Button title="Reintentar" onPress={onRetry} testID={testIds.state.retry} />
      ) : null}
    </View>
  );
}

export function ForbiddenState({
  description = "No tienes permiso para ver esta pantalla.",
}: {
  description?: string;
}) {
  return (
    <View style={styles.centered} testID={testIds.state.forbidden}>
      <Text variant="heading">Sin permiso</Text>
      <Text tone="muted" style={styles.centeredText}>
        {description}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    alignItems: "center",
    flex: 1,
    gap: spacing.md,
    justifyContent: "center",
    padding: spacing.xl,
  },
  centeredText: {
    textAlign: "center",
  },
});
