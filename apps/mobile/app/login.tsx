import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../src/store/auth";

export default function LoginScreen() {
  const router = useRouter();
  const signIn = useAuth((s) => s.signIn);
  const signingIn = useAuth((s) => s.signingIn);
  const error = useAuth((s) => s.error);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function handleSubmit() {
    if (!email.trim() || !password) return;
    const ok = await signIn(email.trim(), password);
    if (ok) router.replace("/(tabs)/inbox");
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <View style={styles.body}>
          <View style={styles.brand}>
            <Text style={styles.brandTitle}>NexaFlow</Text>
            <Text style={styles.brandSubtitle}>
              WhatsApp + AI for your business
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Sign in</Text>
            <View style={styles.field}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                placeholder="you@example.com"
                style={styles.input}
                placeholderTextColor="#94a3b8"
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Password</Text>
              <TextInput
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                placeholder="••••••••"
                style={styles.input}
                placeholderTextColor="#94a3b8"
              />
            </View>

            {error && <Text style={styles.error}>{error}</Text>}

            <Pressable
              onPress={handleSubmit}
              disabled={signingIn || !email || !password}
              style={({ pressed }) => [
                styles.button,
                (signingIn || !email || !password) && styles.buttonDisabled,
                pressed && styles.buttonPressed,
              ]}
            >
              <Text style={styles.buttonText}>
                {signingIn ? "Signing in…" : "Sign in"}
              </Text>
            </Pressable>
          </View>

          <Text style={styles.hint}>
            Use your NexaFlow web credentials. To create an account, sign up
            from the web dashboard.
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc" },
  flex: { flex: 1 },
  body: { flex: 1, padding: 20, justifyContent: "center" },
  brand: { alignItems: "center", marginBottom: 32 },
  brandTitle: { fontSize: 32, fontWeight: "700", color: "#0f172a" },
  brandSubtitle: { fontSize: 14, color: "#64748b", marginTop: 4 },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    shadowColor: "#0f172a",
    shadowOpacity: 0.04,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#0f172a",
    marginBottom: 16,
  },
  field: { marginBottom: 12 },
  label: {
    fontSize: 12,
    fontWeight: "600",
    color: "#475569",
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: "#0f172a",
    backgroundColor: "#ffffff",
  },
  error: {
    color: "#b91c1c",
    backgroundColor: "#fee2e2",
    borderColor: "#fecaca",
    borderWidth: 1,
    borderRadius: 6,
    padding: 8,
    fontSize: 12,
    marginBottom: 12,
  },
  button: {
    backgroundColor: "#10b981",
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 4,
  },
  buttonPressed: { backgroundColor: "#059669" },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: "#ffffff", fontWeight: "600", fontSize: 16 },
  hint: {
    fontSize: 11,
    color: "#64748b",
    textAlign: "center",
    marginTop: 16,
  },
});
