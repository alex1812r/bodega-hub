import { Link } from "expo-router";
import { StyleSheet, View } from "react-native";

import { spacing } from "@/theme/tokens";
import { Text } from "@/ui";

export default function NotFoundScreen() {
  return (
    <View style={styles.container}>
      <Text variant="heading">Esta pantalla no existe</Text>
      <Link href="/">
        <Text tone="primary">Volver al inicio</Text>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    flex: 1,
    gap: spacing.md,
    justifyContent: "center",
    padding: spacing.xl,
  },
});
