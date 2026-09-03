import { useState } from "react";
import { StyleSheet, TextInput, View, type TextInputProps } from "react-native";

import { useTheme } from "@/theme/ThemeContext";
import { minTouchSize, radius, spacing } from "@/theme/tokens";

import { Text } from "./Text";

export type InputProps = TextInputProps & {
  label?: string;
  error?: string | null;
  hint?: string;
};

export function Input({ label, error, hint, style, ...props }: InputProps) {
  const { theme } = useTheme();
  const [focused, setFocused] = useState(false);

  const borderColor = error ? theme.danger : focused ? theme.primary : theme.border;

  return (
    <View style={styles.wrapper}>
      {label ? (
        <Text variant="label" tone="muted">
          {label}
        </Text>
      ) : null}
      <TextInput
        {...props}
        accessibilityLabel={props.accessibilityLabel ?? label}
        onFocus={(event) => {
          setFocused(true);
          props.onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          props.onBlur?.(event);
        }}
        placeholderTextColor={theme.textSubtle}
        style={[
          styles.input,
          {
            backgroundColor: theme.card,
            borderColor,
            color: theme.text,
          },
          style,
        ]}
      />
      {error ? (
        <Text variant="caption" tone="danger">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" tone="subtle">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    borderRadius: radius.md,
    borderWidth: 1,
    fontSize: 16,
    minHeight: minTouchSize,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  wrapper: {
    gap: spacing.xs,
    width: "100%",
  },
});
