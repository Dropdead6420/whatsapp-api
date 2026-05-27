# NexaFlow Mobile (Android + iOS)

React Native + Expo Router app. Slice 1 ships login → tabs (Inbox / Leads /
Settings). Push notifications, conversation detail, AI Reply, and voice
notes land in slice 2+.

## Run locally

```sh
cd apps/mobile
npm install                # one-time; pulls Expo + RN + Firebase
EXPO_PUBLIC_API_URL="https://api.medscrub.in" npm run android
```

The `EXPO_PUBLIC_API_URL` env var must point at your NexaFlow API. For
emulator builds against a locally-running API, use the emulator host alias:

```sh
EXPO_PUBLIC_API_URL="http://10.0.2.2:3001" npm run android   # Android
EXPO_PUBLIC_API_URL="http://localhost:3001" npm run ios       # iOS
```

## Sign in

Use your existing NexaFlow web credentials. Account creation is not
supported from the mobile app — sign up from the web dashboard first.

## What works

**Slice 1**
- Auth — token storage via `AsyncStorage`, validated against
  `GET /api/v1/auth/me` on cold start so signed-in users skip the login
  screen.
- Inbox tab — `GET /api/v1/conversations` rendered as a freshest-first
  list. Pull-to-refresh; refreshes on tab focus.
- Leads tab — `GET /api/v1/leads` flattened into a single list, open
  leads first, with status pill + value + follow-up state.
- Settings tab — shows current user + API URL, sign-out button.

**Slice 2**
- Tap a conversation row → detail screen with message timeline.
- Compose box sends via `POST /api/v1/conversations/:id/messages`
  (new conversation-scoped endpoint; gated by CONVERSATION_REPLY so
  agents can use it from the phone).
- "AI" button drafts up to 3 reply suggestions via
  `POST /api/v1/ai/reply-suggestions`; tap any suggestion to pre-fill
  the compose box.

**Slice 3**
- Real-time message arrival: when the conversation detail screen is
  open, inbound messages from Meta + outbound messages from other
  clients appear instantly via Socket.io (`/realtime` endpoint, JWT in
  the `auth` payload, per-conversation room joined on mount).
- Tap a lead row → detail screen with status chips, AI follow-up
  drafting, save / send / dismiss actions. Uses the existing
  `/leads/:id` + `/leads/:id/follow-up/*` endpoints (new
  `GET /leads/:id` was added on the backend in the same slice).

**Slice 4**
- Firebase Cloud Messaging push notifications: device tokens are
  registered with the backend on every cold start (via
  `POST /api/v1/devices`); the inbound WhatsApp webhook fans out push
  to every device in the tenant; tapping a notification deep-links to
  `/conversations/[id]`.
- Sign-out unregisters this device's token so the previous user stops
  receiving push for this tenant.

### Push setup checklist (slice 4)

For push to actually fire end-to-end:

1. **Backend env var** `FIREBASE_SERVICE_ACCOUNT_JSON` — paste the full
   Firebase service account JSON (with `project_id` / `client_email` /
   `private_key`). Without it, the backend logs once on boot and skips
   push silently — the rest of the app still works.
2. **Mobile native config** — the Expo dev client / EAS build must
   include `google-services.json` (Android) under `apps/mobile/`. Set
   `EXPO_PUBLIC_API_URL` pointing at the same backend instance.
3. **Run on a real device** — `@react-native-firebase/messaging` does
   not work in Expo Go; build the dev client via `eas build --profile
   development --platform android` or test on an APK.

## What does not work yet (slice 5+)

- Foreground in-app banner (FCM doesn't show one by default on Android;
  needs Notifee local notification)
- Voice note recording + sending
- Image / file attachments
- Offline message queue (sends fail outright when offline)

## Project layout

```
app/
  _layout.tsx           # root Stack; hydrates auth on boot
  index.tsx             # redirects to /(tabs)/inbox or /login
  login.tsx             # sign-in screen
  (tabs)/
    _layout.tsx         # Tabs nav, redirects to /login when unauth
    inbox.tsx           # conversations list
    leads.tsx           # leads list
    settings.tsx        # sign-out
src/
  lib/api.ts            # axios + AsyncStorage token store + api.get/post/...
  store/auth.ts         # Zustand store: user, hydrate, signIn, signOut
```
