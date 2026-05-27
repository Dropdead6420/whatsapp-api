import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams } from "expo-router";
import { api, ApiClientError } from "../../src/lib/api";

// Lead detail — mobile slice 3. Operators can change the lead's status,
// generate / edit / send an AI follow-up, and dismiss recommendations.
// Reuses the same /leads/:id endpoints the web inbox uses.

type LeadStatus =
  | "NEW"
  | "QUALIFIED"
  | "NEGOTIATION"
  | "PROPOSAL_SENT"
  | "NEGOTIATION_FAILED"
  | "CLOSED_WON"
  | "CLOSED_LOST";

type FollowUpStatus =
  | "RECOMMENDED"
  | "SCHEDULED"
  | "SENT"
  | "DISMISSED"
  | "FAILED"
  | null;

interface LeadDetail {
  id: string;
  title: string;
  description: string | null;
  status: LeadStatus;
  value: number | null;
  probability: number | null;
  contact: { id: string; name: string; phoneNumber: string; optedOut: boolean };
  followUpStatus: FollowUpStatus;
  followUpPriority: string | null;
  followUpMessage: string | null;
  followUpReason: string | null;
  followUpDueAt: string | null;
  followUpRecommendedAt: string | null;
  followUpSentAt: string | null;
  followUpLastError: string | null;
  updatedAt: string;
}

const STATUS_LIST: LeadStatus[] = [
  "NEW",
  "QUALIFIED",
  "NEGOTIATION",
  "PROPOSAL_SENT",
  "NEGOTIATION_FAILED",
  "CLOSED_WON",
  "CLOSED_LOST",
];

const STATUS_LABELS: Record<LeadStatus, string> = {
  NEW: "New",
  QUALIFIED: "Qualified",
  NEGOTIATION: "Negotiation",
  PROPOSAL_SENT: "Proposal sent",
  NEGOTIATION_FAILED: "Stalled",
  CLOSED_WON: "Won",
  CLOSED_LOST: "Lost",
};

export default function LeadDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const leadId = typeof id === "string" ? id : "";

  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const load = useCallback(async () => {
    if (!leadId) return;
    setError(null);
    try {
      const data = await api.get<LeadDetail>(`/api/v1/leads/${leadId}`);
      setLead(data);
      setDraft(data.followUpMessage ?? "");
    } catch (e) {
      setError(
        e instanceof ApiClientError ? e.message : "Failed to load lead.",
      );
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function changeStatus(status: LeadStatus) {
    if (!lead || status === lead.status) return;
    setBusy("status");
    try {
      const updated = await api.patch<LeadDetail>(`/api/v1/leads/${lead.id}`, {
        status,
      });
      setLead(updated);
    } catch (e) {
      Alert.alert(
        "Status update failed",
        e instanceof ApiClientError ? e.message : "Try again.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function recommendFollowUp() {
    if (!lead) return;
    setBusy("recommend");
    try {
      const result = await api.post<{ lead: LeadDetail }>(
        `/api/v1/leads/${lead.id}/follow-up/recommend`,
        { goal: "Move this lead to the next best sales step." },
      );
      setLead(result.lead);
      setDraft(result.lead.followUpMessage ?? "");
    } catch (e) {
      Alert.alert(
        "AI recommendation failed",
        e instanceof ApiClientError ? e.message : "Try again.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function saveDraft() {
    if (!lead) return;
    setBusy("save");
    try {
      const updated = await api.patch<LeadDetail>(
        `/api/v1/leads/${lead.id}/follow-up`,
        { followUpMessage: draft },
      );
      setLead(updated);
    } catch (e) {
      Alert.alert(
        "Save failed",
        e instanceof ApiClientError ? e.message : "Try again.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function sendNow() {
    if (!lead) return;
    if (lead.contact.optedOut) {
      Alert.alert("Contact opted out", "Cannot send WhatsApp follow-ups to this contact.");
      return;
    }
    Alert.alert(
      "Send follow-up?",
      "This sends the draft as a WhatsApp message immediately.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Send",
          style: "default",
          onPress: async () => {
            setBusy("send");
            try {
              if (draft && draft !== lead.followUpMessage) {
                await api.patch(`/api/v1/leads/${lead.id}/follow-up`, {
                  followUpMessage: draft,
                });
              }
              await api.post(`/api/v1/leads/${lead.id}/follow-up/send`);
              await load();
            } catch (e) {
              Alert.alert(
                "Send failed",
                e instanceof ApiClientError ? e.message : "Try again.",
              );
            } finally {
              setBusy(null);
            }
          },
        },
      ],
    );
  }

  async function dismiss() {
    if (!lead) return;
    setBusy("dismiss");
    try {
      const updated = await api.patch<LeadDetail>(
        `/api/v1/leads/${lead.id}/follow-up`,
        { followUpStatus: "DISMISSED" },
      );
      setLead(updated);
    } catch (e) {
      Alert.alert(
        "Dismiss failed",
        e instanceof ApiClientError ? e.message : "Try again.",
      );
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.flex} edges={["bottom"]}>
        <Stack.Screen options={{ title: "Lead" }} />
        <View style={styles.center}>
          <ActivityIndicator color="#10b981" />
        </View>
      </SafeAreaView>
    );
  }

  if (error || !lead) {
    return (
      <SafeAreaView style={styles.flex} edges={["bottom"]}>
        <Stack.Screen options={{ title: "Lead" }} />
        <View style={styles.center}>
          <Text style={styles.errorText}>{error ?? "Lead not found."}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.flex} edges={["bottom"]}>
      <Stack.Screen
        options={{
          title: lead.title || "Lead",
          headerBackTitle: "Leads",
        }}
      />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.card}>
          <Text style={styles.label}>Contact</Text>
          <Text style={styles.name}>{lead.contact.name}</Text>
          <Text style={styles.contactSub}>
            {lead.contact.phoneNumber}
            {lead.contact.optedOut && (
              <Text style={styles.optedOut}> · opted out</Text>
            )}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Status</Text>
          <View style={styles.statusGrid}>
            {STATUS_LIST.map((s) => {
              const active = s === lead.status;
              return (
                <Pressable
                  key={s}
                  onPress={() => void changeStatus(s)}
                  disabled={busy === "status" || active}
                  style={({ pressed }) => [
                    styles.statusChip,
                    active && styles.statusChipActive,
                    pressed && styles.statusChipPressed,
                  ]}
                >
                  <Text
                    style={[
                      styles.statusChipText,
                      active && styles.statusChipTextActive,
                    ]}
                  >
                    {STATUS_LABELS[s]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.followHeader}>
            <Text style={styles.label}>AI follow-up</Text>
            {lead.followUpStatus && (
              <Text style={styles.followStatus}>
                {lead.followUpStatus}
                {lead.followUpPriority && ` · ${lead.followUpPriority}`}
              </Text>
            )}
          </View>

          {lead.followUpReason && (
            <Text style={styles.reason}>{lead.followUpReason}</Text>
          )}
          {lead.followUpLastError && (
            <Text style={styles.error}>{lead.followUpLastError}</Text>
          )}

          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Generate a draft, then edit before sending."
            placeholderTextColor="#94a3b8"
            multiline
            style={styles.draft}
          />

          <View style={styles.actionsRow}>
            <Pressable
              onPress={() => void recommendFollowUp()}
              disabled={busy !== null}
              style={({ pressed }) => [
                styles.actionGhost,
                pressed && styles.actionGhostPressed,
                busy !== null && styles.actionDisabled,
              ]}
            >
              <Text style={styles.actionGhostText}>
                {busy === "recommend" ? "Generating…" : "Draft with AI"}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => void saveDraft()}
              disabled={busy !== null || !draft.trim()}
              style={({ pressed }) => [
                styles.actionGhost,
                pressed && styles.actionGhostPressed,
                (busy !== null || !draft.trim()) && styles.actionDisabled,
              ]}
            >
              <Text style={styles.actionGhostText}>
                {busy === "save" ? "Saving…" : "Save draft"}
              </Text>
            </Pressable>
          </View>

          <View style={styles.actionsRow}>
            <Pressable
              onPress={() => void sendNow()}
              disabled={busy !== null || !draft.trim() || lead.contact.optedOut}
              style={({ pressed }) => [
                styles.actionPrimary,
                pressed && styles.actionPrimaryPressed,
                (busy !== null || !draft.trim() || lead.contact.optedOut) &&
                  styles.actionDisabled,
              ]}
            >
              <Text style={styles.actionPrimaryText}>
                {busy === "send" ? "Sending…" : "Send WhatsApp now"}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => void dismiss()}
              disabled={busy !== null || !lead.followUpStatus}
              style={({ pressed }) => [
                styles.actionGhost,
                pressed && styles.actionGhostPressed,
                (busy !== null || !lead.followUpStatus) && styles.actionDisabled,
              ]}
            >
              <Text style={styles.actionGhostText}>
                {busy === "dismiss" ? "…" : "Dismiss"}
              </Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: "#f8fafc" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  scroll: { padding: 12, gap: 12 },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  label: {
    fontSize: 11,
    fontWeight: "700",
    color: "#475569",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  name: { fontSize: 18, fontWeight: "600", color: "#0f172a" },
  contactSub: { fontSize: 13, color: "#475569", marginTop: 2 },
  optedOut: { color: "#b91c1c", fontWeight: "600" },
  statusGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  statusChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: "#f1f5f9",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  statusChipPressed: { backgroundColor: "#e2e8f0" },
  statusChipActive: {
    backgroundColor: "#10b981",
    borderColor: "#10b981",
  },
  statusChipText: { fontSize: 12, fontWeight: "600", color: "#334155" },
  statusChipTextActive: { color: "#ffffff" },
  followHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  followStatus: {
    fontSize: 10,
    fontWeight: "700",
    color: "#0369a1",
    backgroundColor: "#e0f2fe",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  reason: { fontSize: 12, color: "#475569", marginTop: 4 },
  error: {
    fontSize: 12,
    color: "#b91c1c",
    backgroundColor: "#fee2e2",
    padding: 6,
    borderRadius: 6,
    marginTop: 6,
  },
  errorText: { color: "#b91c1c", fontSize: 14 },
  draft: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 8,
    padding: 10,
    minHeight: 100,
    marginTop: 10,
    color: "#0f172a",
    fontSize: 14,
    backgroundColor: "#ffffff",
    textAlignVertical: "top",
  },
  actionsRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  actionGhost: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    alignItems: "center",
    backgroundColor: "#ffffff",
  },
  actionGhostPressed: { backgroundColor: "#f1f5f9" },
  actionGhostText: { fontSize: 13, fontWeight: "600", color: "#0f172a" },
  actionPrimary: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: "#10b981",
    alignItems: "center",
  },
  actionPrimaryPressed: { backgroundColor: "#059669" },
  actionPrimaryText: { fontSize: 13, fontWeight: "600", color: "#ffffff" },
  actionDisabled: { opacity: 0.5 },
});
