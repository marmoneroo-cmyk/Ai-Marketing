import type { Role } from './enums';

/**
 * The full set of granular permissions. Roles map to subsets of these; NestJS
 * guards check a required permission against the caller's role.
 */
export const PERMISSIONS = [
  'org:manage',
  'members:manage',
  'billing:manage',
  'brain:read',
  'brain:write',
  'content:read',
  'content:create',
  'content:approve',
  'content:publish',
  'conversation:read',
  'conversation:reply',
  'conversation:auto_reply',
  'sales:read',
  'sales:quote',
  'sales:payment',
  'crm:read',
  'crm:write',
  'analytics:read',
  'automation:manage',
  'settings:manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL: readonly Permission[] = PERMISSIONS;

/** Role → permissions. Immutable; never mutate at runtime. */
export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  owner: ALL,
  admin: ALL.filter((p) => p !== 'billing:manage' && p !== 'org:manage'),
  marketer: [
    'brain:read',
    'content:read',
    'content:create',
    'content:approve',
    'content:publish',
    'conversation:read',
    'conversation:reply',
    'analytics:read',
    'crm:read',
  ],
  sales: [
    'brain:read',
    'conversation:read',
    'conversation:reply',
    'sales:read',
    'sales:quote',
    'sales:payment',
    'crm:read',
    'crm:write',
    'analytics:read',
  ],
  viewer: ['brain:read', 'content:read', 'conversation:read', 'sales:read', 'crm:read', 'analytics:read'],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
