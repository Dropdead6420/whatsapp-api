import { Tabs, Redirect } from "expo-router";
import { Text } from "react-native";
import { useAuth } from "../../src/store/auth";

// Tab navigator for authenticated users. Each tab has a colored emoji icon
// so we don't drag in @expo/vector-icons as a dep. Inbox is the landing tab.
//
// If we land here without a user, redirect to /login — defensive against
// direct deep links bypassing the index splash.

function TabIcon({ emoji, color }: { emoji: string; color: string }) {
  return (
    <Text style={{ fontSize: 20, color, lineHeight: 24 }}>{emoji}</Text>
  );
}

export default function TabsLayout() {
  const user = useAuth((s) => s.user);
  if (!user) return <Redirect href="/login" />;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: "#10b981",
        tabBarInactiveTintColor: "#94a3b8",
        tabBarStyle: { backgroundColor: "#ffffff", borderTopColor: "#e2e8f0" },
        headerStyle: { backgroundColor: "#ffffff" },
        headerTitleStyle: { fontWeight: "600", color: "#0f172a" },
      }}
    >
      <Tabs.Screen
        name="inbox"
        options={{
          title: "Inbox",
          tabBarIcon: ({ color }) => <TabIcon emoji="💬" color={color} />,
        }}
      />
      <Tabs.Screen
        name="leads"
        options={{
          title: "Leads",
          tabBarIcon: ({ color }) => <TabIcon emoji="🎯" color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color }) => <TabIcon emoji="⚙️" color={color} />,
        }}
      />
    </Tabs>
  );
}
