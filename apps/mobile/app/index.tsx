import { Redirect } from "expo-router";
import { useAuth } from "../src/store/auth";

// Splash → redirect. By the time we render, _layout has already hydrated
// auth state, so the user lands on the right route immediately on cold
// start (no flash of login screen for already-signed-in users).

export default function Index() {
  const user = useAuth((s) => s.user);
  return <Redirect href={user ? "/(tabs)/inbox" : "/login"} />;
}
