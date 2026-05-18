import http from "k6/http";
import { check } from "k6";

// synthetic-checks (T-123). Runs the production-relevant probes against a
// single deployment to catch silent regressions:
//
//   1. GET /live              — process is up.
//   2. GET /api/v1/health     — Express + JSON response.
//   3. GET /api/v1/ready      — Postgres + Redis reachable.
//   4. GET /public/booking/<known-tenant>/services
//                              — public path, no auth, real DB read.
//   5. POST /api/v1/auth/login (deliberately bad password)
//                              — login pipeline returns its canonical 401.
//
// Intended to run from an external probe (Cloudflare Workers cron, Pingdom,
// Datadog Synthetics, GitHub Actions cron) every minute against staging and
// every 5 minutes against prod. k6 exits non-zero if any threshold fails so
// the runner can page on regression.

const BASE_URL = __ENV.BASE_URL || "http://localhost:3001";
const PUBLIC_TENANT_ID = __ENV.PUBLIC_TENANT_ID || "";

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: {
    http_req_duration: ["p(95)<1000"],
    checks: ["rate==1.0"],
  },
};

export default function () {
  const live = http.get(`${BASE_URL}/live`);
  check(live, {
    "live 200": (r) => r.status === 200,
    "live body alive": (r) => /"status":"alive"/.test(r.body ?? ""),
  });

  const health = http.get(`${BASE_URL}/api/v1/health`);
  check(health, {
    "health 200": (r) => r.status === 200,
    "health body ok": (r) => /"status":"ok"/.test(r.body ?? ""),
  });

  const ready = http.get(`${BASE_URL}/api/v1/ready`);
  check(ready, {
    "ready 200": (r) => r.status === 200,
    "ready postgres+redis ok": (r) => {
      try {
        const body = JSON.parse(r.body ?? "{}");
        return (
          body.status === "ready" &&
          body.services?.every?.((s) => s.ok === true)
        );
      } catch {
        return false;
      }
    },
  });

  if (PUBLIC_TENANT_ID) {
    const services = http.get(
      `${BASE_URL}/public/booking/${PUBLIC_TENANT_ID}/services`,
    );
    check(services, {
      "public booking 200 or 404": (r) =>
        r.status === 200 || r.status === 404,
    });
  }

  const badLogin = http.post(
    `${BASE_URL}/api/v1/auth/login`,
    JSON.stringify({
      email: "synthetic-probe@nowhere.invalid",
      password: "intentionally-wrong-12345",
    }),
    { headers: { "Content-Type": "application/json" } },
  );
  check(badLogin, {
    // 401 (bad credentials) or 429 (synthetic ran too often) are both
    // healthy — they prove the login pipeline is end-to-end reachable.
    "login canonical reject": (r) =>
      r.status === 401 || r.status === 429,
  });
}
