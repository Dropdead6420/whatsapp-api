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

// Leads — kanban-by-status flattened into a single list. Slice 1 is
// read-only; tapping a row, recommend follow-up, send WhatsApp, etc.
// land in slice 2.

interface Lead {
  id: string;
  title: string;
  description: string | null;
  status:
    | "NEW"
    | "QUALIFIED"
    | "NEGOTIATION"
    | "PROPOSAL_SENT"
    | "NEGOTIATION_FAILED"
    | "CLOSED_WON"
    | "CLOSED_LOST";
  value: number | null;
  followUpStatus?:
    | "RECOMMENDED"
    | "SCHEDULED"
    | "SENT"
    | "DISMISSED"
    | "FAILED"
    | null;
  followUpPriority?: string | null;
  contact: { id: string; name: string; phoneNumber: string };
  updatedAt: string;
}

interface LeadsBoardResp {
  // Some routes return a board (status → leads[]), others a flat array.
  // Accept both shapes defensively.
  byStatus?: Record<string, Lead[]>;
  leads?: Lead[];
}

const STATUS_LABELS: Record<Lead["status"], string> = {
  NEW: "New",
  QUALIFIED: "Qualified",
  NEGOTIATION: "Negotiation",
  PROPOSAL_SENT: "Proposal sent",
  NEGOTIATION_FAILED: "Stalled",
  CLOSED_WON: "Won",
  CLOSED_LOST: "Lost",
};

const STATUS_COLORS: Record<Lead["status"], { bg: string; fg: string }> = {
  NEW: { bg: "#dbeafe", fg: "#1e40af" },
  QUALIFIED: { bg: "#fef3c7", fg: "#92400e" },
  NEGOTIATION: { bg: "#fed7aa", fg: "#9a3412" },
  PROPOSAL_SENT: { bg: "#e9d5ff", fg: "#6b21a8" },
  NEGOTIATION_FAILED: { bg: "#fecaca", fg: "#991b1b" },
  CLOSED_WON: { bg: "#bbf7d0", fg: "#166534" },
  CLOSED_LOST: { bg: "#e5e7eb", fg: "#374151" },
};

function flattenBoard(resp: Lead[] | LeadsBoardResp): Lead[] {
  if (Array.isArray(resp)) return resp;
  if (resp.byStatus) {
    return Object.values(resp.byStatus).flat();
  }
  return resp.leads ?? [];
}

export default function LeadsScreen() {
  const [items, setItems] = useState<Lead[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const raw = await api.get<Lead[] | LeadsBoardResp>("/api/v1/leads");
      const flat = flattenBoard(raw);
      // Open leads first (anything not closed), most recently updated.
      flat.sort((a, b) => {
        const aClosed = a.status === "CLOSED_WON" || a.status === "CLOSED_LOST";
        const bClosed = b.status === "CLOSED_WON" || b.status === "CLOSED_LOST";
        if (aClosed !== bClosed) return aClosed ? 1 : -1;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
      setItems(flat);
    } catch (e) {
      setError(
        e instanceof ApiClientError ? e.message : "Failed to load leads.",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
          <Text style={styles.emptyTitle}>No leads yet</Text>
          <Text style={styles.emptyBody}>
            Leads will appear here as they come in from WhatsApp, Meta Lead
            Ads, or your CRM imports.
          </Text>
        </View>
      )}
      <FlatList
        data={items}
        keyExtractor={(l) => l.id}
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
        renderItem={({ item }) => {
          const colors = STATUS_COLORS[item.status];
          return (
            <Pressable
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            >
              <View style={styles.rowTop}>
                <Text numberOfLines={2} style={styles.title}>
                  {item.title}
                </Text>
                <View
                  style={[styles.statusPill, { backgroundColor: colors.bg }]}
                >
                  <Text style={[styles.statusText, { color: colors.fg }]}>
                    {STATUS_LABELS[item.status]}
                  </Text>
                </View>
              </View>
              <Text numberOfLines={1} style={styles.contact}>
                {item.contact.name} · {item.contact.phoneNumber}
              </Text>
              <View style={styles.rowMeta}>
                {item.value != null && (
                  <Text style={styles.value}>
                    ₹{item.value.toLocaleString("en-IN")}
                  </Text>
                )}
                {item.followUpStatus && (
                  <Text style={styles.followUp}>
                    Follow-up: {item.followUpStatus.toLowerCase()}
                    {item.followUpPriority && ` · ${item.followUpPriority}`}
                  </Text>
                )}
              </View>
            </Pressable>
          );
        }}
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
  emptyBody: {
    fontSize: 13,
    color: "#64748b",
    marginTop: 4,
    textAlign: "center",
  },
  flexEmpty: { flexGrow: 1, justifyContent: "center" },
  row: { padding: 14, backgroundColor: "#ffffff" },
  rowPressed: { backgroundColor: "#f1f5f9" },
  rowTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 8,
  },
  title: { fontSize: 15, fontWeight: "600", color: "#0f172a", flex: 1 },
  statusPill: {
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  statusText: { fontSize: 10, fontWeight: "700", textTransform: "uppercase" },
  contact: { fontSize: 12, color: "#64748b", marginTop: 4 },
  rowMeta: { flexDirection: "row", gap: 12, marginTop: 6 },
  value: { fontSize: 12, fontWeight: "600", color: "#047857" },
  followUp: { fontSize: 11, color: "#475569" },
  separator: { height: 1, backgroundColor: "#e2e8f0" },
});
