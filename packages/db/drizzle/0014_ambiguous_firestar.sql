CREATE INDEX IF NOT EXISTS "social_accounts_provider_external_idx" ON "social_accounts" USING btree ("provider","external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "insights_org_kind_created_idx" ON "insights" USING btree ("org_id","kind","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_approvals_org_item_idx" ON "content_approvals" USING btree ("org_id","content_item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "creative_assets_org_job_idx" ON "creative_assets" USING btree ("org_id","job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "creative_jobs_org_item_idx" ON "creative_jobs" USING btree ("org_id","content_item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_messages_org_conv_created_idx" ON "conversation_messages" USING btree ("org_id","conversation_id","created_at");