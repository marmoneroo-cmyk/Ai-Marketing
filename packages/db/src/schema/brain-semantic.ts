import { pgTable, uuid, text, integer, jsonb, timestamp, vector, index } from 'drizzle-orm/pg-core';
import { primaryId } from './_shared';
import { orgRef } from './identity';

/** Semantic memory (RAG). Every document/post/review/message is chunked + embedded here. */

export const knowledgeSources = pgTable('knowledge_sources', {
  id: primaryId(),
  orgId: orgRef(),
  kind: text('kind').notNull(), // instagram_post | website_page | review | dm | pdf | catalog | ...
  externalRef: text('external_ref'),
  permission: text('permission').notNull().default('public'), // public | granted | restricted
  fetchedAt: timestamp('fetched_at', { withTimezone: true }),
  meta: jsonb('meta').notNull().default({}),
});

export const knowledgeDocuments = pgTable('knowledge_documents', {
  id: primaryId(),
  orgId: orgRef(),
  sourceId: uuid('source_id').references(() => knowledgeSources.id, { onDelete: 'cascade' }),
  title: text('title'),
  content: text('content').notNull(),
  lang: text('lang'),
  hash: text('hash'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const knowledgeChunks = pgTable(
  'knowledge_chunks',
  {
    id: primaryId(),
    orgId: orgRef(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => knowledgeDocuments.id, { onDelete: 'cascade' }),
    chunkIndex: integer('chunk_index').notNull(),
    content: text('content').notNull(),
    // 1024 dims = Voyage voyage-3 embeddings.
    embedding: vector('embedding', { dimensions: 1024 }).notNull(),
    tokenCount: integer('token_count'),
    metadata: jsonb('metadata').notNull().default({}), // { kind, recency, permission, confidence }
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Approximate-nearest-neighbor index for cosine similarity search.
    index('knowledge_chunks_embedding_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
    index('knowledge_chunks_org_idx').on(t.orgId),
  ],
);
