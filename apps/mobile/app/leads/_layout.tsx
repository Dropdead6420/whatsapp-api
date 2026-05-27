import { Stack } from "expo-router";

export default function LeadsLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: "#ffffff" },
        headerTitleStyle: { fontWeight: "600", color: "#0f172a" },
        headerTintColor: "#0f172a",
      }}
    />
  );
}
