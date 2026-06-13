#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const sshHost = process.env.NEXAFLOW_VPS_HOST || 'root@187.127.172.138';
const appDir = process.env.NEXAFLOW_VPS_APP_DIR || '/opt/medscub';
const postgresContainer = process.env.NEXAFLOW_POSTGRES_CONTAINER || 'medscub-postgres';
const postgresUser = process.env.NEXAFLOW_POSTGRES_USER || 'nexaflow';
const postgresDb = process.env.NEXAFLOW_POSTGRES_DB || 'nexaflow_dev';

const schema = ssh(`cat ${shellQuote(`${appDir}/packages/db/prisma/schema.prisma`)}`);
const prismaTables = parsePrismaTables(schema.stdout).sort();

const dbTablesResult = ssh(
  [
    `docker exec ${shellQuote(postgresContainer)}`,
    `psql -U ${shellQuote(postgresUser)} -d ${shellQuote(postgresDb)} -Atc`,
    shellQuote("select table_name from information_schema.tables where table_schema = 'public' order by table_name;"),
  ].join(' '),
);
const dbTables = dbTablesResult.stdout
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .sort();

const dbTableSet = new Set(dbTables);
const prismaTableSet = new Set(prismaTables);
const missing = prismaTables.filter((table) => !dbTableSet.has(table));
const extra = dbTables.filter((table) => !prismaTableSet.has(table));

console.log(`Prisma models: ${prismaTables.length}`);
console.log(`Postgres tables: ${dbTables.length}`);
console.log(`Missing tables: ${missing.length ? `\n${missing.join('\n')}` : 'none'}`);
console.log(`Extra tables: ${extra.length ? `\n${extra.join('\n')}` : 'none'}`);

if (missing.length > 0) {
  process.exit(1);
}

function parsePrismaTables(schemaText) {
  const tables = [];
  const modelPattern = /model\s+([A-Za-z_][A-Za-z0-9_]*)\s+\{([\s\S]*?)\n\}/g;
  let match;
  while ((match = modelPattern.exec(schemaText))) {
    const name = match[1];
    const body = match[2];
    const mapped = body.match(/@@map\("([^"]+)"\)/);
    tables.push(mapped ? mapped[1] : name);
  }
  return tables;
}

function ssh(command) {
  const result = spawnSync(
    'ssh',
    ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=12', sshHost, command],
    { encoding: 'utf8' },
  );

  if (result.status !== 0) {
    if (result.stdout) {
      console.error(result.stdout.trim());
    }
    if (result.stderr) {
      console.error(result.stderr.trim());
    }
    process.exit(result.status || 1);
  }

  return result;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}
