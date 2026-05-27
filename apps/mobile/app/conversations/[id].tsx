import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { api, ApiClientError } from "../../src/lib/api";

// Conversation detail — message timeline + compose box + AI Reply.
//
// Slice 2 ships: load existing thread, send a new outbound message via
// POST /conversations/:id/messages, and ask Claude for reply suggestions
// via POST /ai/reply-suggestions. Slice 3 wires Socket.io so the screen
// updates in real time when a new inbound arrives or the operator's web
// client sends a reply.

interface MessageRow {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  status?: string;
  content: string;
  createdAt: string;
  metaMessageId?: string | null;
}

interface ContactRow {
  id: string;
  name: string;
  phoneNumber: string;
}

interface ConversationDetail {
  id: string;
  isActive: boolean;
  contact: ContactRow;
  messages: MessageRow[];
  lastMessageAt?: string | null;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ConversationDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const conversationId = typeof id === "string" ? id : "";

  const [convo, setConvo] = useState<ConversationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);

  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestErr, setSuggestErr] = useState<string | null>(null);

  const listRef = useRef<FlatList<MessageRow>>(null);

  const load = useCallback(async () => {
    if (!conversationId) return;
    setLoadErr(null);
    try {
      const data = await api.get<ConversationDetail>(
        `/api/v1/conversations/${conversationId}`,
      );
      setConvo(data);
    } catch (e) {
      setLoadErr(
        e instanceof ApiClientError
          ? e.message
          : "Failed to load conversation.",
      );
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Scroll to the newest message whenever the list changes. FlatList's
  // `inverted` would be cleaner but reverses gesture direction; this is
  // good enough for slice 2.
  useEffect(() => {
    if (!convo || convo.messages.length === 0) return;
    const t = setTimeout(() => {
      listRef.current?.scrollToEnd({ animated: false });
    }, 50);
    return () => clearTimeout(t);
  }, [convo?.messages.length]);

  async function handleSend() {
    if (!draft.trim() || !convo) return;
    setSending(true);
    setSendErr(null);
    try {
      const message = await api.post<MessageRow>(
        `/api/v1/conversations/${convo.id}/messages`,
        { body: draft.trim() },
      );
      // Append optimistically — server returns the persisted row.
      setConvo((prev) =>
        prev ? { ...prev, messages: [...prev.messages, message] } : prev,
      );
      setDraft("");
      setSuggestions(null);
    } catch (e) {
      setSendErr(e instanceof ApiClientError ? e.message : "Send failed.");
    } finally {
      setSending(false);
    }
  }

  async function handleSuggest() {
    if (!convo) return;
    setSuggesting(true);
    setSuggestErr(null);
    setSuggestions(null);
    try {
      // /ai/reply-suggestions returns { suggestions: string[] } per the
      // API shape.
      const data = await api.post<{ suggestions: string[] }>(
        "/api/v1/ai/reply-suggestions",
        { conversationId: convo.id },
      );
      setSuggestions(data.suggestions ?? []);
    } catch (e) {
      setSuggestErr(
        e instanceof ApiClientError
          ? e.message
          : "Failed to get AI suggestions.",
      );
    } finally {
      setSuggesting(false);
    }
  }

  const headerTitle = convo?.contact?.name ?? "Conversation";

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <Stack.Screen
        options={{
          title: headerTitle,
          headerBackTitle: "Inbox",
          headerRight: () =>
            convo ? (
              <Text style={styles.headerPhone}>
                {convo.contact.phoneNumber}
              </Text>
            ) : null,
        }}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
        keyboardVerticalOffset={Platform.OS === "ios" ? 80 : 0}
      >
        {loading && (
          <View style={styles.center}>
            <ActivityIndicator color="#10b981" />
          </View>
        )}
        {loadErr && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{loadErr}</Text>
            <Pressable onPress={() => void load()}>
              <Text style={styles.retry}>Retry</Text>
            </Pressable>
          </View>
        )}

        {convo && (
          <FlatList
            ref={listRef}
            data={convo.messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => {
              const outbound = item.direction === "OUTBOUND";
              return (
                <View
                  style={[
                    styles.bubbleRow,
                    outbound ? styles.bubbleRowRight : styles.bubbleRowLeft,
                  ]}
                >
                  <View
                    style={[
                      styles.bubble,
                      outbound ? styles.bubbleOut : styles.bubbleIn,
                    ]}
                  >
                    <Text
                      style={[
                        styles.bubbleText,
                        outbound && styles.bubbleTextOut,
                      ]}
                    >
                      {item.content}
                    </Text>
                    <Text
                      style={[
                        styles.bubbleTime,
                        outbound && styles.bubbleTimeOut,
                      ]}
                    >
                      {formatTime(item.createdAt)}
                    </Text>
                  </View>
                </View>
              );
            }}
            ListEmptyComponent={
              <View style={styles.center}>
                <Text style={styles.emptyText}>No messages yet.</Text>
              </View>
            }
          />
        )}

        {suggestions !== null && (
          <View style={styles.suggestBox}>
            <View style={styles.suggestHeader}>
              <Text style={styles.suggestHeaderText}>AI suggestions</Text>
              <Pressable onPress={() => setSuggestions(null)}>
                <Text style={styles.suggestDismiss}>Hide</Text>
              </Pressable>
            </View>
            {suggestions.length === 0 ? (
              <Text style={styles.suggestEmpty}>
                No suggestions for this conversation right now.
              </Text>
            ) : (
              suggestions.map((s, idx) => (
                <Pressable
                  key={idx}
                  onPress={() => {
                    setDraft(s);
                    setSuggestions(null);
                  }}
                  style={({ pressed }) => [
                    styles.suggestion,
                    pressed && styles.suggestionPressed,
                  ]}
                >
                  <Text style={styles.suggestionText}>{s}</Text>
                </Pressable>
              ))
            )}
          </View>
        )}

        {suggestErr && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{suggestErr}</Text>
          </View>
        )}

        {sendErr && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{sendErr}</Text>
          </View>
        )}

        <View style={styles.composer}>
          <Pressable
            onPress={() => void handleSuggest()}
            disabled={suggesting || !convo}
            style={({ pressed }) => [
              styles.aiButton,
              (suggesting || !convo) && styles.aiButtonDisabled,
              pressed && styles.aiButtonPressed,
            ]}
          >
            <Text style={styles.aiButtonText}>
              {suggesting ? "…" : "AI"}
            </Text>
          </Pressable>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Reply…"
            placeholderTextColor="#94a3b8"
            multiline
            style={styles.input}
            editable={!sending && !!convo}
          />
          <Pressable
            onPress={() => void handleSend()}
            disabled={sending || !draft.trim() || !convo}
            style={({ pressed }) => [
              styles.sendButton,
              (sending || !draft.trim() || !convo) && styles.sendButtonDisabled,
              pressed && styles.sendButtonPressed,
            ]}
          >
            <Text style={styles.sendButtonText}>
              {sending ? "…" : "Send"}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      {/* Subtle back-to-inbox hint for the bottom edge */}
      {!convo && !loading && !loadErr && (
        <Pressable
          onPress={() => router.back()}
          style={styles.backFallback}
        >
          <Text style={styles.backFallbackText}>← Back to inbox</Text>
        </Pressable>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc" },
  flex: { flex: 1 },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  emptyText: { fontSize: 13, color: "#64748b" },
  errorBanner: {
    backgroundColor: "#fee2e2",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderColor: "#fecaca",
    borderTopWidth: 1,
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  errorBannerText: { color: "#b91c1c", fontSize: 12, flex: 1 },
  retry: { color: "#b91c1c", fontWeight: "600", fontSize: 12 },
  headerPhone: { fontSize: 11, color: "#64748b", marginRight: 8 },

  list: { padding: 12, paddingBottom: 16 },
  bubbleRow: { marginVertical: 3 },
  bubbleRowLeft: { alignItems: "flex-start" },
  bubbleRowRight: { alignItems: "flex-end" },
  bubble: {
    maxWidth: "82%",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
  },
  bubbleIn: {
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 2,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  bubbleOut: {
    backgroundColor: "#10b981",
    borderTopRightRadius: 2,
  },
  bubbleText: { color: "#0f172a", fontSize: 15 },
  bubbleTextOut: { color: "#ffffff" },
  bubbleTime: {
    fontSize: 10,
    color: "#94a3b8",
    marginTop: 4,
    alignSelf: "flex-end",
  },
  bubbleTimeOut: { color: "#d1fae5" },

  suggestBox: {
    backgroundColor: "#f8fafc",
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    padding: 10,
    gap: 6,
  },
  suggestHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  suggestHeaderText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#475569",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  suggestDismiss: { fontSize: 12, color: "#0369a1", fontWeight: "600" },
  suggestEmpty: {
    fontSize: 12,
    color: "#64748b",
    paddingVertical: 6,
    textAlign: "center",
  },
  suggestion: {
    backgroundColor: "#ffffff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 10,
  },
  suggestionPressed: { backgroundColor: "#f1f5f9" },
  suggestionText: { fontSize: 14, color: "#0f172a", lineHeight: 20 },

  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    padding: 8,
    gap: 6,
    backgroundColor: "#ffffff",
    borderTopColor: "#e2e8f0",
    borderTopWidth: 1,
  },
  aiButton: {
    height: 40,
    paddingHorizontal: 10,
    borderRadius: 20,
    backgroundColor: "#0369a1",
    justifyContent: "center",
    alignItems: "center",
  },
  aiButtonPressed: { backgroundColor: "#075985" },
  aiButtonDisabled: { opacity: 0.5 },
  aiButtonText: { color: "#ffffff", fontWeight: "700", fontSize: 12 },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 140,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: "#0f172a",
    backgroundColor: "#ffffff",
  },
  sendButton: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: "#10b981",
    justifyContent: "center",
    alignItems: "center",
  },
  sendButtonPressed: { backgroundColor: "#059669" },
  sendButtonDisabled: { opacity: 0.5 },
  sendButtonText: { color: "#ffffff", fontWeight: "600", fontSize: 14 },

  backFallback: { padding: 16, alignItems: "center" },
  backFallbackText: { color: "#0369a1", fontSize: 14 },
});
