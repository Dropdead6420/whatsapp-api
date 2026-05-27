import { useCallback, useEffect, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { api, ApiClientError } from "../../src/lib/api";

// Inbox — list of WhatsApp conversations, freshest first. Slice 1 is
// read-only; tapping a row doesn't navigate anywhere yet (conversation
// detail + reply compose are slice 2).

interface Conversation {
  id: string;
  isActive: boolean;
  labels: string[];
  unreadCount?: number;
  lastMessageAt: string | null;
  contact: { id: string; name: string; phoneNumber: string };
  lastMessage?: { content: string; direction: "INBOUND" | "OUTBOUND" } | null;
}

interface ConversationListResp {
  items?: Conversation[];
  data?: Conversation[];
}

function formatRelative(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

export default function InboxScreen() {
  const [items, setItems] = useState<Conversation[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      // The conversations endpoint can wrap data in either {data:[...]}
      // or include pagination metadata; accept both.
      const raw = await api.get<Conversation[] | ConversationListResp>(
        "/api/v1/conversations?limit=50&isActive=true",
      );
      const list = Array.isArray(raw)
        ? raw
        : raw.items ?? raw.data ?? [];
      setItems(list);
    } catch (e) {
      setError(
        e instanceof ApiClientError ? e.message : "Failed to load inbox.",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Reload whenever the tab regains focus so the inbox stays fresh after
  // a backgrounded interval.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <View style={styles.container}>
      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}
      {!loading && items.length === 0 && !error && (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No active conversations</Text>
          <Text style={styles.emptyBody}>
            New WhatsApp messages will show up here.
          </Text>
        </View>
      )}
      <FlatList
        data={items}
        keyExtractor={(c) => c.id}
        contentContainerStyle={items.length === 0 ? styles.flexEmpty : undefined}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            tintColor="#10b981"
          />
        }
        renderItem={({ item }) => (
          <Pressable style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {item.contact.name.charAt(0).toUpperCase() || "?"}
              </Text>
            </View>
            <View style={styles.body}>
              <View style={styles.rowTop}>
                <Text numberOfLines={1} style={styles.name}>
                  {item.contact.name}
                </Text>
                <Text style={styles.time}>
                  {formatRelative(item.lastMessageAt)}
                </Text>
              </View>
              <View style={styles.rowBottom}>
                <Text numberOfLines={1} style={styles.preview}>
                  {item.lastMessage?.direction === "OUTBOUND" && "you: "}
                  {item.lastMessage?.content || item.contact.phoneNumber}
                </Text>
                {item.unreadCount && item.unreadCount > 0 ? (
                  <View style={styles.unread}>
                    <Text style={styles.unreadText}>
                      {item.unreadCount > 99 ? "99+" : item.unreadCount}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>
          </Pressable>
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc" },
  errorBanner: {
    backgroundColor: "#fee2e2",
    borderBottomColor: "#fecaca",
    borderBottomWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  errorText: { color: "#b91c1c", fontSize: 12 },
  empty: { padding: 32, alignItems: "center" },
  emptyTitle: { fontSize: 16, fontWeight: "600", color: "#0f172a" },
  emptyBody: { fontSize: 13, color: "#64748b", marginTop: 4, textAlign: "center" },
  flexEmpty: { flexGrow: 1, justifyContent: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#ffffff",
  },
  rowPressed: { backgroundColor: "#f1f5f9" },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#dcfce7",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  avatarText: { fontSize: 18, fontWeight: "600", color: "#047857" },
  body: { flex: 1 },
  rowTop: { flexDirection: "row", justifyContent: "space-between" },
  rowBottom: { flexDirection: "row", justifyContent: "space-between", marginTop: 2 },
  name: { fontSize: 15, fontWeight: "600", color: "#0f172a", flex: 1 },
  time: { fontSize: 11, color: "#64748b", marginLeft: 8 },
  preview: { fontSize: 13, color: "#475569", flex: 1 },
  unread: {
    backgroundColor: "#10b981",
    minWidth: 20,
    paddingHorizontal: 6,
    height: 20,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 8,
  },
  unreadText: { color: "#ffffff", fontSize: 11, fontWeight: "600" },
  separator: { height: 1, backgroundColor: "#e2e8f0", marginLeft: 72 },
});
