import { StyleSheet, View, type ViewProps } from "react-native";

import { useTheme } from "@/theme/ThemeContext";
import { radius, spacing } from "@/theme/tokens";

export function Card({ style, ...props }: ViewProps) {
  const { theme } = useTheme();

  return (
    <View
      {...props}
      style={[
        styles.card,
        { backgroundColor: theme.card, borderColor: theme.cardBorder },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.lg,
  },
});
