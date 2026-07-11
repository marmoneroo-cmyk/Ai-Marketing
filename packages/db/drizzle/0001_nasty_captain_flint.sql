CREATE INDEX IF NOT EXISTS "content_items_org_plan_idx" ON "content_items" USING btree ("org_id","plan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_items_org_created_idx" ON "content_items" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_variants_item_created_idx" ON "content_variants" USING btree ("content_item_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scheduled_posts_status_scheduled_idx" ON "scheduled_posts" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deals_lead_idx" ON "deals" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_org_created_idx" ON "leads" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointments_org_starts_idx" ON "appointments" USING btree ("org_id","starts_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_step_runs_org_run_ran_idx" ON "workflow_step_runs" USING btree ("org_id","run_id","ran_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflows_org_enabled_idx" ON "workflows" USING btree ("org_id","enabled");