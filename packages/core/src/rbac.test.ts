import { describe, it, expect } from 'vitest';
import { hasPermission } from './rbac';

describe('rbac.hasPermission', () => {
  it('grants owner every permission including billing', () => {
    expect(hasPermission('owner', 'billing:manage')).toBe(true);
    expect(hasPermission('owner', 'sales:payment')).toBe(true);
  });

  it('denies viewer any write access', () => {
    expect(hasPermission('viewer', 'content:create')).toBe(false);
    expect(hasPermission('viewer', 'crm:write')).toBe(false);
  });

  it('grants marketer publishing but not payments', () => {
    expect(hasPermission('marketer', 'content:publish')).toBe(true);
    expect(hasPermission('marketer', 'sales:payment')).toBe(false);
  });

  it('grants sales payments but not content publishing', () => {
    expect(hasPermission('sales', 'sales:payment')).toBe(true);
    expect(hasPermission('sales', 'content:publish')).toBe(false);
  });

  it('withholds org and billing management from admin', () => {
    expect(hasPermission('admin', 'org:manage')).toBe(false);
    expect(hasPermission('admin', 'billing:manage')).toBe(false);
    expect(hasPermission('admin', 'content:approve')).toBe(true);
  });
});
