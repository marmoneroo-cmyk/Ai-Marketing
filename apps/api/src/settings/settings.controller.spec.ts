import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@brandpilot/db';

/**
 * Trust-boundary regression guard for the caps escalation footgun.
 *
 * `settings.caps` overrides may raise a plan cap (a deliberate server/support
 * escape-hatch — see `readCapsOverride` in @brandpilot/config), so they MUST NOT
 * be writable from tenant/client input, or an org could self-escalate every
 * ceiling. This test pins the write boundary: `setAutonomy` persists ONLY
 * `autonomyMode`, even when handed a hostile body that smuggles `caps` past the
 * validation pipe. If a future change ever lets `caps` reach `.set(...)`, this
 * fails loudly.
 *
 * A stubbed `withOrgScope` runs the handler's callback against a fake tx that
 * records the `.set(...)` payload.
 */
const { recorder } = vi.hoisted(() => ({
  recorder: { setArgs: [] as Record<string, unknown>[] },
}));

vi.mock('@brandpilot/db', async (importActual) => {
  const actual = await importActual<typeof import('@brandpilot/db')>();
  const tx = {
    update: () => ({
      set: (values: Record<string, unknown>) => {
        recorder.setArgs.push(values);
        return { where: () => Promise.resolve([]) };
      },
    }),
  };
  return {
    ...actual,
    withOrgScope: (_db: unknown, _orgId: string, cb: (t: unknown) => unknown) => cb(tx),
  };
});

import { SettingsController } from './settings.controller';

type SetAutonomyBody = Parameters<SettingsController['setAutonomy']>[1];

describe('SettingsController.setAutonomy — caps trust boundary', () => {
  it('persists only autonomyMode, never a client-supplied caps field', async () => {
    recorder.setArgs.length = 0;
    const controller = new SettingsController({} as unknown as Database);

    // Hostile/malformed body smuggling caps: even if it reached the handler
    // (bypassing the global Zod pipe, which already strips unknown keys), caps
    // must never be persisted.
    await controller.setAutonomy('org-1', {
      mode: 'auto',
      caps: { maxChannels: 999, monthlyBudget: 1_000_000 },
    } as unknown as SetAutonomyBody);

    expect(recorder.setArgs).toHaveLength(1);
    const persisted = recorder.setArgs[0]!;
    // Only autonomyMode is written; caps is absent from the persisted payload.
    expect(Object.keys(persisted)).toEqual(['autonomyMode']);
    expect(persisted).not.toHaveProperty('caps');
  });
});
