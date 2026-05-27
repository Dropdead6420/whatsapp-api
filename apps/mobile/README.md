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

## What does not work yet (slice 3+)

- Push notifications via Firebase Cloud Messaging
- Real-time message arrival via Socket.io
- Voice note recording + sending
- Lead → status change / mark follow-up sent

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
