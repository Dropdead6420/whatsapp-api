import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "../../src/store/auth";
import { API_BASE } from "../../src/lib/api";

export default function SettingsScreen() {
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const signOut = useAuth((s) => s.signOut);

  async function handleSignOut() {
    Alert.alert("Sign out", "Sign out of NexaFlow on this device?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: async () => {
          await signOut();
          router.replace("/login");
        },
      },
    ]);
  }

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.label}>Signed in as</Text>
        <Text style={styles.name}>{user?.name ?? "—"}</Text>
        <Text style={styles.email}>{user?.email ?? ""}</Text>
        <Text style={styles.role}>{user?.role}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>API endpoint</Text>
        <Text style={styles.value}>{API_BASE}</Text>
      </View>

      <Pressable
        onPress={handleSignOut}
        style={({ pressed }) => [styles.signOut, pressed && styles.signOutPressed]}
      >
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>

      <Text style={styles.hint}>
        Mobile app v0.1 · slice 1: inbox + leads (read-only). Push
        notifications, chat compose, and AI reply land in slice 2.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc", padding: 16 },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  label: {
    fontSize: 11,
    fontWeight: "600",
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  name: { fontSize: 18, fontWeight: "600", color: "#0f172a" },
  email: { fontSize: 13, color: "#475569", marginTop: 2 },
  role: {
    fontSize: 10,
    color: "#0369a1",
    backgroundColor: "#e0f2fe",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    alignSelf: "flex-start",
    marginTop: 8,
    fontWeight: "600",
  },
  value: { fontSize: 13, fontFamily: "Courier", color: "#0f172a" },
  signOut: {
    backgroundColor: "#fee2e2",
    borderColor: "#fecaca",
    borderWidth: 1,
    padding: 12,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 8,
  },
  signOutPressed: { backgroundColor: "#fecaca" },
  signOutText: { color: "#b91c1c", fontWeight: "600", fontSize: 15 },
  hint: {
    fontSize: 11,
    color: "#64748b",
    textAlign: "center",
    marginTop: 24,
    paddingHorizontal: 16,
  },
});
