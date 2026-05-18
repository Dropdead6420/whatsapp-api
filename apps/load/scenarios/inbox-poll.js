import http from "k6/http";
import { check, sleep } from "k6";
import { Rate } from "k6/metrics";

// inbox-poll — simulates 500 agents polling the conversations list every
// 5s, the way the current inbox UI does (no WS yet — that's Phase C).
// Phase A pass: p95 < 400ms, error rate < 0.1%.

const errorRate = new Rate("inbox_errors");

const BASE_URL = __ENV.BASE_URL || "http://localhost:3001";
const AUTH_TOKEN = __ENV.AUTH_TOKEN;

if (!AUTH_TOKEN) {
  throw new Error("AUTH_TOKEN env var is required");
}

export const options = {
  stages: [
    { duration: "1m", target: 100 },
    { duration: "2m", target: 500 },
    { duration: "2m", target: 500 },
    { duration: "30s", target: 0 },
  ],
  thresholds: {
    http_req_duration: ["p(95)<400"],
    http_req_failed: ["rate<0.001"],
    inbox_errors: ["rate<0.01"],
  },
};

export default function () {
  const params = {
    headers: {
      Authorization: `Bearer ${AUTH_TOKEN}`,
      "Content-Type": "application/json",
    },
  };

  const res = http.get(`${BASE_URL}/api/v1/conversations?limit=25`, params);
  const ok = check(res, {
    "status is 200": (r) => r.status === 200,
    "response has data": (r) => r.body && r.body.length > 0,
  });
  errorRate.add(!ok);

  sleep(5);
}
