#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const baseUrl = normalizeBaseUrl(process.env.NEXAFLOW_BASE_URL || 'http://187.127.172.138');
const adminEmail = process.env.NEXAFLOW_ADMIN_EMAIL;
const adminPassword = process.env.NEXAFLOW_ADMIN_PASSWORD;
const sshHost = process.env.NEXAFLOW_VPS_HOST || 'root@187.127.172.138';
const skipSsh = process.env.NEXAFLOW_SKIP_SSH === '1';

const publicRoutes = [
  '/',
  '/login',
  '/dashboard',
  '/google-monitor',
  '/credit-rules',
  '/ai-template-categories',
  '/ai-prompts',
  '/cms',
  '/plan-pricing',
];

const authenticatedRoutes = [
  '/api/v1/ready',
  '/api/v1/admin/google-monitor/logs?limit=100',
  '/api/v1/admin/google-monitor/overview',
  '/api/v1/admin/credit-rules',
  '/api/v1/admin/ai-template-categories',
  '/api/v1/admin/ai-prompts',
  '/api/v1/admin/ai-prompts/coverage',
  '/api/v1/admin/cms',
  '/api/v1/admin/managed-services/packages',
  '/api/v1/admin/managed-services/engagements',
];

const failures = [];

console.log(`NexaFlow VPS smoke check: ${baseUrl}`);

for (const route of publicRoutes) {
  await checkRoute(route);
}

let token = null;
if (adminEmail && adminPassword) {
  token = await login();
  if (token) {
    for (const route of authenticatedRoutes) {
      await checkRoute(route, token);
    }
  }
} else {
  console.log('skip auth routes: set NEXAFLOW_ADMIN_EMAIL and NEXAFLOW_ADMIN_PASSWORD');
}

if (!skipSsh && sshHost) {
  checkSsh();
}

if (failures.length > 0) {
  console.error('\nSmoke check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('\nSmoke check passed.');

async function login() {
  try {
    const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    });

    const body = await readResponseBody(response);
    if (!response.ok) {
      failures.push(`POST /api/v1/auth/login returned ${response.status}: ${body.preview}`);
      return null;
    }

    const token =
      body.json?.data?.accessToken ||
      body.json?.accessToken ||
      body.json?.token ||
      body.json?.data?.token;

    if (!token) {
      failures.push('POST /api/v1/auth/login returned 200 but no access token');
      return null;
    }

    console.log('OK  200 POST /api/v1/auth/login');
    return token;
  } catch (error) {
    failures.push(`POST /api/v1/auth/login failed: ${formatError(error)}`);
    return null;
  }
}

async function checkRoute(route, tokenArg = null) {
  try {
    const response = await fetch(`${baseUrl}${route}`, {
      headers: tokenArg ? { authorization: `Bearer ${tokenArg}` } : undefined,
    });
    const body = await readResponseBody(response);
    const ok = response.status >= 200 && response.status < 400;

    if (!ok) {
      failures.push(`GET ${route} returned ${response.status}: ${body.preview}`);
      console.log(`BAD ${response.status} GET ${route}`);
      return;
    }

    console.log(`OK  ${response.status} GET ${route}`);
  } catch (error) {
    failures.push(`GET ${route} failed: ${formatError(error)}`);
    console.log(`BAD ERR GET ${route}`);
  }
}

function checkSsh() {
  const status = spawnSync(
    'ssh',
    [
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=12',
      sshHost,
      [
        'set -e',
        'docker ps --format "{{.Names}} {{.Status}}"',
        'echo "--- recent api errors ---"',
        'docker logs --since 3m medscub-api 2>&1 | grep -E "INTERNAL_SERVER_ERROR|PrismaClientKnownRequestError|does not exist|Unhandled|ERROR" || true',
      ].join('; '),
    ],
    { encoding: 'utf8' },
  );

  if (status.status !== 0) {
    failures.push(`SSH health check failed: ${status.stderr.trim() || status.stdout.trim()}`);
    return;
  }

  const output = status.stdout.trim();
  console.log('\nSSH health snapshot:');
  console.log(output || '(no output)');

  const recentErrors = output.split('--- recent api errors ---')[1]?.trim();
  if (recentErrors) {
    failures.push(`recent medscub-api errors found:\n${recentErrors}`);
  }
}

async function readResponseBody(response) {
  const text = await response.text();
  const preview = text.replace(/\s+/g, ' ').slice(0, 240);
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { text, preview, json };
}

function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, '');
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}
