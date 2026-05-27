import { useEffect } from "react";
import { Stack, Slot } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useAuth } from "../src/store/auth";

// Root layout. Hydrates auth state on first render so screens see either
// `user` populated or `hydrating=false, user=null`. We render <Slot/> while
// hydrating to keep the navigation tree mounted (Stack guards routes
// once hydration finishes).

export default function RootLayout() {
  const hydrating = useAuth((s) => s.hydrating);
  const hydrate = useAuth((s) => s.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

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
      </Stack>
      <Slot />
    </SafeAreaProvider>
  );
}
