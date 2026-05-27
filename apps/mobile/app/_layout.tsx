import { useEffect } from "react";
import { Stack, Slot, useRouter } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useAuth } from "../src/store/auth";
import { registerThisDevice, wirePushHandlers } from "../src/lib/push";

// Root layout. Hydrates auth state on first render so screens see either
// `user` populated or `hydrating=false, user=null`. We render <Slot/> while
// hydrating to keep the navigation tree mounted (Stack guards routes
// once hydration finishes).

export default function RootLayout() {
  const router = useRouter();
  const hydrating = useAuth((s) => s.hydrating);
  const hydrate = useAuth((s) => s.hydrate);
  const user = useAuth((s) => s.user);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // Register the device's FCM token once the user is known, so push
  // fan-out has somewhere to land. Re-runs when the user changes
  // (sign-out → sign-in moves tokens to the new user).
  useEffect(() => {
    if (!user) return;
    void registerThisDevice();
  }, [user?.id]);

  // Wire FCM handlers once per app boot. wirePushHandlers handles cold-
  // start (tap when app was killed) + background-tap deep-links.
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    void wirePushHandlers(router).then((cb) => {
      cleanup = cb;
    });
    return () => cleanup?.();
  }, [router]);

  if (hydrating) {
    return (
      <SafeAreaProvider>
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            alignItems: "center",
            backgroundColor: "#f8fafc",
          }}
        >
          <ActivityIndicator size="large" color="#10b981" />
          <StatusBar style="dark" />
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: "#ffffff" },
          headerTitleStyle: { fontWeight: "600" },
          headerTintColor: "#0f172a",
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="conversations/[id]"
          options={{ presentation: "card" }}
        />
        <Stack.Screen
          name="leads/[id]"
          options={{ presentation: "card" }}
        />
      </Stack>
      <Slot />
    </SafeAreaProvider>
  );
}
