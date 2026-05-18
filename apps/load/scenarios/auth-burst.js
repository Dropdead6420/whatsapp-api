import http from "k6/http";
import { check, sleep } from "k6";
import { Rate } from "k6/metrics";

// auth-burst — ramps to 200 concurrent users hitting POST /auth/login.
// Phase A pass: p95 < 500ms, error rate < 0.1%.

const errorRate = new Rate("login_errors");

const BASE_URL = __ENV.BASE_URL || "http://localhost:3001";
const EMAIL = __ENV.LOGIN_EMAIL || "admin@example.com";
const PASSWORD = __ENV.LOGIN_PASSWORD || "password123";

export const options = {
  stages: [
    { duration: "30s", target: 50 },
    { duration: "1m", target: 200 },
    { duration: "1m", target: 200 },
    { duration: "30s", target: 0 },
  ],
  thresholds: {
    http_req_duration: ["p(95)<500"],
    http_req_failed: ["rate<0.001"],
    login_errors: ["rate<0.01"],
  },
};

export default function () {
  const payload = JSON.stringify({ email: EMAIL, password: PASSWORD });
  const params = { headers: { "Content-Type": "application/json" } };

  const res = http.post(`${BASE_URL}/api/v1/auth/login`, payload, params);
  const ok = check(res, {
    "status is 200 or 401": (r) => r.status === 200 || r.status === 401,
  });
  errorRate.add(!ok);

  sleep(0.5);
}
