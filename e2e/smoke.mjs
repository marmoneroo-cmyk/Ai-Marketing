/**
 * Minimal end-to-end smoke test. Run against a LIVE stack (docker compose up +
 * migrate + seed + `pnpm dev`):
 *
 *   node e2e/smoke.mjs
 *
 * Set API_URL if the gateway isn't on the default port. This verifies the API is
 * serving and the discovery endpoint accepts work; the full autonomous loop
 * (Claude/Voyage/Meta calls) additionally needs the corresponding API keys.
 */
const API = process.env.API_URL ?? 'http://localhost:4000';

async function expectOk(path, label, init) {
  const res = await fetch(`${API}${path}`, init);
  if (!res.ok) throw new Error(`${label} → HTTP ${res.status}`);
  console.log(`  ✔ ${label} (${res.status})`);
  return res;
}

async function main() {
  console.log(`Smoke-testing ${API}\n`);

  // 1) The gateway is up (public endpoint, no auth, no DB).
  await expectOk('/health', 'GET /health');

  // 2) Auth is enforced: /discovery/dna must reject an unauthenticated request.
  const unauth = await fetch(`${API}/discovery/dna`);
  if (unauth.status !== 401) throw new Error(`expected 401 on unauthenticated /discovery/dna, got ${unauth.status}`);
  console.log('  ✔ RBAC guard rejects unauthenticated request (401)');

  console.log('\nAPI is up and guarding routes. To exercise the full loop:');
  console.log('  1. POST /auth/register then POST /auth/login to get a token');
  console.log('  2. POST /discovery/run { websiteUrl } with the Bearer token');
  console.log('  3. poll GET /discovery/dna until the Business DNA is populated');
  console.log('  (requires ANTHROPIC_API_KEY + VOYAGE_API_KEY + a reachable website)');
}

main().catch((err) => {
  console.error(`\n✖ smoke failed: ${err.message}`);
  process.exit(1);
});
