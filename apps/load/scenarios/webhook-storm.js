import http from "k6/http";
import crypto from "k6/crypto";
import { check } from "k6";
import { Rate } from "k6/metrics";

// webhook-storm — fires inbound Meta webhook payloads at sustained 200 rps.
// Each payload carries a unique wamid so the Message.metaMessageId @unique
// idempotency path doesn't deduplicate the load away.
//
// Requires META_APP_SECRET so the script can compute X-Hub-Signature-256
// the same way Meta does. Without it, the API will reject every request as
// signature-mismatch.
//
// Phase A pass: 200 rps sustained for 5 minutes, error rate < 0.1%.

const errorRate = new Rate("webhook_errors");

const BASE_URL = __ENV.BASE_URL || "http://localhost:3001";
const META_APP_SECRET = __ENV.META_APP_SECRET;
const PHONE_NUMBER_ID = __ENV.PHONE_NUMBER_ID || "PNID-LOAD";

if (!META_APP_SECRET) {
  throw new Error("META_APP_SECRET env var is required");
}

export const options = {
  scenarios: {
    storm: {
      executor: "constant-arrival-rate",
      rate: 200,
      timeUnit: "1s",
      duration: "5m",
      preAllocatedVUs: 100,
      maxVUs: 400,
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<300"],
    http_req_failed: ["rate<0.001"],
    webhook_errors: ["rate<0.001"],
  },
};

function buildPayload(wamid) {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA-LOAD",
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "15551234567",
                phone_number_id: PHONE_NUMBER_ID,
              },
              contacts: [
                {
                  profile: { name: "Load Test" },
                  wa_id: "15551234567",
                },
              ],
              messages: [
                {
                  from: "15551234567",
                  id: wamid,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: "text",
                  text: { body: "load test ping" },
                },
              ],
            },
            field: "messages",
          },
        ],
      },
    ],
  });
}

export default function () {
  const wamid = `wamid.LOAD_${__VU}_${__ITER}_${Date.now()}`;
  const body = buildPayload(wamid);

  const signature =
    "sha256=" + crypto.hmac("sha256", META_APP_SECRET, body, "hex");

  const params = {
    headers: {
      "Content-Type": "application/json",
      "X-Hub-Signature-256": signature,
    },
  };

  const res = http.post(`${BASE_URL}/webhooks/whatsapp`, body, params);
  const ok = check(res, {
    "status is 200": (r) => r.status === 200,
  });
  errorRate.add(!ok);
}
