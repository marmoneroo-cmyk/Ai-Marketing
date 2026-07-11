import { pgTable, uuid, text, boolean, timestamp, index } from 'drizzle-orm/pg-core';
import { primaryId } from './_shared';
import { users, orgRef } from './identity';
import { services } from './brain-structured';
import { contacts, leads } from './crm';

/** Appointments: bookable availability and scheduled meetings. */

export const availabilitySlots = pgTable('availability_slots', {
  id: primaryId(),
  orgId: orgRef(),
  userId: uuid('user_id').references(() => users.id), // consultant, nullable for org-level
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  isBooked: boolean('is_booked').notNull().default(false),
});

export const appointments = pgTable(
  'appointments',
  {
    id: primaryId(),
    orgId: orgRef(),
    contactId: uuid('contact_id').references(() => contacts.id),
    leadId: uuid('lead_id').references(() => leads.id),
    serviceId: uuid('service_id').references(() => services.id),
    slotId: uuid('slot_id').references(() => availabilitySlots.id),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    status: text('status')
      .$type<'booked' | 'confirmed' | 'completed' | 'no_show' | 'canceled'>()
      .notNull()
      .default('booked'),
    location: text('location'), // physical / video link
    externalRef: text('external_ref'), // calendar event id
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  // Dashboard rollup filters appointments by (orgId, status) within a startsAt window.
  (t) => [index('appointments_org_starts_idx').on(t.orgId, t.startsAt)],
);
