import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { isDemoAuthEnabled } from "@/api/config";
import { useAuth } from "@/auth/AuthContext";
import { testIds } from "@/testIds";
import { useTheme } from "@/theme/ThemeContext";
import { spacing } from "@/theme/tokens";
import { Button, Input, Text } from "@/ui";

const DEV_TAP_COUNT = 5;

export default function LoginScreen() {
  const { signIn, signOutReason } = useAuth();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const tapCount = useRef(0);

  const handleSubmit = async () => {
    if (isSubmitting) {
      return;
    }

    if (!email.trim() || !password) {
      setError("Escribe tu correo y contrasena.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const result = await signIn(email.trim(), password);

    setIsSubmitting(false);

    if (!result.ok) {
      setError(result.message ?? "No se pudo iniciar sesion.");
    }
  };

  const handleLogoPress = () => {
    if (!isDemoAuthEnabled()) {
      return;
    }

    tapCount.current += 1;

    if (tapCount.current >= DEV_TAP_COUNT) {
      tapCount.current = 0;
      router.push("/dev");
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={[styles.flex, { backgroundColor: theme.pageSurface }]}
    >
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + spacing.xl, paddingTop: insets.top + spacing.xxl },
        ]}
        keyboardShouldPersistTaps="handled"
        testID={testIds.login.screen}
      >
        <Pressable
          accessibilityLabel="BodegaHub"
          onPress={handleLogoPress}
          testID={testIds.login.logo}
        >
          <Text variant="title" style={{ color: theme.primary }}>
            BodegaHub
          </Text>
        </Pressable>
        <Text tone="muted">Entra con tu cuenta de la bodega.</Text>

        {signOutReason ? (
          <View style={[styles.notice, { backgroundColor: theme.warningSoft }]}>
            <Text variant="caption" style={{ color: theme.warning }}>
              {signOutReason}
            </Text>
          </View>
        ) : null}

        <View style={styles.form}>
          <Input
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            label="Correo"
            onChangeText={setEmail}
            placeholder="tucorreo@ejemplo.com"
            testID={testIds.login.email}
            value={email}
          />
          <Input
            autoCapitalize="none"
            autoComplete="current-password"
            label="Contrasena"
            onChangeText={setPassword}
            onSubmitEditing={handleSubmit}
            placeholder="Tu contrasena"
            returnKeyType="go"
            secureTextEntry
            testID={testIds.login.password}
            value={password}
          />

          {error ? (
            <Text testID={testIds.login.error} tone="danger" variant="caption">
              {error}
            </Text>
          ) : null}

          <Button
            isLoading={isSubmitting}
            onPress={handleSubmit}
            size="lg"
            testID={testIds.login.submit}
            title="Entrar"
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    gap: spacing.md,
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  flex: {
    flex: 1,
  },
  form: {
    gap: spacing.lg,
    marginTop: spacing.xl,
  },
  notice: {
    borderRadius: 10,
    padding: spacing.md,
  },
});
