import { loadEnv } from '@brandpilot/config';
import { createDb } from './client';
import { organizations, users, memberships } from './schema/index';

/** Seed a demo organization with an owner so the app is browsable locally. */
async function main(): Promise<void> {
  const env = loadEnv();
  const db = createDb(env.DATABASE_URL);

  const [org] = await db
    .insert(organizations)
    .values({ name: 'Demo Co', slug: 'demo-co', industry: 'services' })
    .returning();

  const [user] = await db
    .insert(users)
    .values({ email: 'owner@demo.co', name: 'Demo Owner' })
    .returning();

  if (org && user) {
    await db.insert(memberships).values({ orgId: org.id, userId: user.id, role: 'owner' });
  }

  console.log('✔ Seeded demo organization (demo-co).');
  process.exit(0);
}

main().catch((err) => {
  console.error('✖ Seed failed:', err);
  process.exit(1);
});
