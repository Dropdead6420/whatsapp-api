// Mobile-side push notification glue.
//
// Wraps @react-native-firebase/messaging:
//   1. ensurePermission() — asks the OS once (iOS) or returns true (Android
//      ≤12). On Android 13+, POST_NOTIFICATIONS permission prompts via a
//      dedicated runtime permission flow but messaging.requestPermission()
//      handles it.
//   2. getFcmToken() — returns the device FCM token; null if unavailable.
//   3. registerThisDevice() — gets the token + POSTs it to /api/v1/devices
//      so the backend can fan-out push for this user.
//   4. wirePushHandlers(router) — sets up:
//        - foreground onMessage (we surface inline UI via banner, but FCM
//          doesn't show an OS notification for foreground messages on
//          Android by default — slice 5 can add a Notifee local-only
//          notification banner)
//        - onNotificationOpenedApp (tap from background → deep link)
//        - getInitialNotification (cold-start tap → deep link)
//
// We keep this paranoid: every call is wrapped in try/catch because
// @react-native-firebase silently throws when the native module isn't
// linked (e.g. running in Expo Go without an EAS Dev Client). Slice 4 is
// usable in a real APK; in Expo Go everything is a no-op.

import type { Router } from "expo-router";
import { Platform } from "react-native";
import { api, ApiClientError } from "./api";

interface MessagingModule {
  default: () => {
    requestPermission: () => Promise<number>;
    hasPermission: () => Promise<number>;
    getToken: () => Promise<string | null>;
    onMessage: (cb: (msg: RemoteMessage) => void) => () => void;
    onNotificationOpenedApp: (cb: (msg: RemoteMessage) => void) => () => void;
    getInitialNotification: () => Promise<RemoteMessage | null>;
    AuthorizationStatus: {
      AUTHORIZED: number;
      PROVISIONAL: number;
      DENIED: number;
      NOT_DETERMINED: number;
    };
  };
}

interface RemoteMessage {
  data?: Record<string, string>;
  notification?: { title?: string; body?: string };
}

async function getMessaging(): Promise<MessagingModule["default"] | null> {
  try {
    const mod = (await import("@react-native-firebase/messaging")) as unknown as
      | MessagingModule
      | { default: MessagingModule["default"] };
    // dynamic import shape can be either { default } or the module itself
    const fn =
      (mod as MessagingModule).default ??
      (mod as { default: MessagingModule["default"] }).default;
    return fn ?? null;
  } catch (err) {
    if ((err as Error).message?.includes("RNFBApp")) {
      // Firebase native module not linked (Expo Go). No-op gracefully.
      return null;
    }
    console.warn("[push] messaging import failed:", (err as Error).message);
    return null;
  }
}

async function ensurePermission(): Promise<boolean> {
  const messaging = await getMessaging();
  if (!messaging) return false;
  try {
    const inst = messaging();
    const status = await inst.requestPermission();
    return (
      status === inst.AuthorizationStatus.AUTHORIZED ||
      status === inst.AuthorizationStatus.PROVISIONAL
    );
  } catch (err) {
    console.warn("[push] permission failed:", (err as Error).message);
    return false;
  }
}

async function getFcmToken(): Promise<string | null> {
  const messaging = await getMessaging();
  if (!messaging) return null;
  try {
    return (await messaging().getToken()) ?? null;
  } catch (err) {
    console.warn("[push] getToken failed:", (err as Error).message);
    return null;
  }
}

/**
 * Idempotent device registration. Safe to call on every cold start +
 * after sign-in: the server upserts on the FCM token.
 */
export async function registerThisDevice(): Promise<void> {
  const granted = await ensurePermission();
  if (!granted) return;
  const token = await getFcmToken();
  if (!token) return;
  try {
    await api.post("/api/v1/devices", {
      fcmToken: token,
      platform: Platform.OS === "ios" ? "IOS" : "ANDROID",
    });
  } catch (err) {
    if (err instanceof ApiClientError) {
      console.warn(`[push] device register HTTP ${err.status}: ${err.message}`);
    } else {
      console.warn("[push] device register failed:", (err as Error).message);
    }
  }
}

/**
 * Best-effort: ask the server to forget this device's FCM token. Called
 * from auth.signOut() so the previous user stops receiving push.
 */
export async function unregisterThisDevice(): Promise<void> {
  const token = await getFcmToken();
  if (!token) return;
  try {
    await api.delete("/api/v1/devices", { fcmToken: token });
  } catch {
    // ignore — local sign-out continues regardless
  }
}

/**
 * Subscribe to message-arrival events from FCM. Returns a cleanup function
 * that detaches the listeners; call it from useEffect.
 */
export async function wirePushHandlers(
  router: Pick<Router, "push">,
): Promise<() => void> {
  const messaging = await getMessaging();
  if (!messaging) return () => undefined;
  const inst = messaging();

  function handleTap(msg: RemoteMessage | null) {
    const conversationId = msg?.data?.conversationId;
    if (typeof conversationId === "string" && conversationId.length > 0) {
      router.push({
        pathname: "/conversations/[id]",
        params: { id: conversationId },
      });
    }
  }

  const unsubForeground = inst.onMessage(() => {
    // Foreground arrivals already trigger a UI refresh via Socket.io
    // (slice 3). We deliberately don't pop a banner here because Android
    // requires a Notifee local notification to show one in foreground;
    // adding that's slice 5 polish.
  });
  const unsubOpened = inst.onNotificationOpenedApp(handleTap);

  // Cold start: app was killed and the user tapped a notification to
  // launch it. getInitialNotification() returns the message that did so.
  void inst.getInitialNotification().then(handleTap);

  return () => {
    try {
      unsubForeground();
      unsubOpened();
    } catch {
      // ignore
    }
  };
}
