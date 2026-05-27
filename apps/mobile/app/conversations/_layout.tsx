import { Stack } from "expo-router";

// Stack wrapper for /conversations/[id]. Inherits the root stack's
// header styling; child screen sets its own title from the contact.

export default function ConversationsLayout() {
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
