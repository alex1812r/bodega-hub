import { StyleSheet, View } from "react-native";

import { useNetworkStatus } from "@/offline/useNetworkStatus";
import { testIds } from "@/testIds";
import { useTheme } from "@/theme/ThemeContext";
import { spacing } from "@/theme/tokens";

import { Text } from "./Text";

export function OfflineBanner() {
  const { isOnline } = useNetworkStatus();
  const { theme } = useTheme();

  if (isOnline) {
    return null;
  }

  return (
    <View
      accessibilityRole="alert"
      style={[styles.banner, { backgroundColor: theme.warningSoft }]}
      testID={testIds.state.offline}
    >
      <Text variant="caption" style={{ color: theme.warning }}>
        Sin conexion. Ves datos guardados y no puedes registrar operaciones.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    width: "100%",
  },
});
