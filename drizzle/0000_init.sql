CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text,
	"actor_id" text,
	"actor_email" text,
	"action" text NOT NULL,
	"target" text,
	"detail" text,
	"impersonated" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"address" text,
	"status" text DEFAULT 'active' NOT NULL,
	"default_playlist_id" text,
	"default_ticker_id" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"branch_ids" text DEFAULT '[]' NOT NULL,
	"token" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "invites_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"number" text NOT NULL,
	"plan" text NOT NULL,
	"screens" integer NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"subtotal" double precision NOT NULL,
	"tax" double precision DEFAULT 0 NOT NULL,
	"tax_label" text DEFAULT 'GST 18%',
	"total" double precision NOT NULL,
	"status" text DEFAULT 'paid' NOT NULL,
	"period_start" text,
	"period_end" text,
	"gateway" text,
	"gateway_invoice_id" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"url" text NOT NULL,
	"bytes" integer DEFAULT 0 NOT NULL,
	"duration" integer DEFAULT 10 NOT NULL,
	"tags" text DEFAULT '[]' NOT NULL,
	"folder" text DEFAULT '/' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'approved' NOT NULL,
	"storage_key" text,
	"renditions" text,
	"rendition_status" text DEFAULT 'none' NOT NULL,
	"rendition_error" text,
	"created_by" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"media_id" text NOT NULL,
	"version" integer NOT NULL,
	"url" text NOT NULL,
	"bytes" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"kind" text NOT NULL,
	"message" text NOT NULL,
	"read" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"plan_tier" text DEFAULT 'trial' NOT NULL,
	"country" text DEFAULT 'IN',
	"gstin" text,
	"status" text DEFAULT 'active' NOT NULL,
	"require_2fa" integer DEFAULT 0 NOT NULL,
	"approval_required" integer DEFAULT 0 NOT NULL,
	"feature_flags" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pairings" (
	"code" text PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"metadata" text DEFAULT '{}' NOT NULL,
	"screen_id" text,
	"device_token" text,
	"expires_at" text NOT NULL,
	"claimed_at" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "play_events" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"screen_id" text NOT NULL,
	"media_id" text,
	"playlist_id" text,
	"duration" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "playlists" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"branch_id" text,
	"name" text NOT NULL,
	"items" text DEFAULT '[]' NOT NULL,
	"status" text DEFAULT 'approved' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publish_events" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"screen_id" text NOT NULL,
	"playlist_id" text,
	"ticker_id" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"actor_id" text,
	"created_at" text NOT NULL,
	"delivered_at" text,
	"rendered_at" text
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"content_type" text DEFAULT 'playlist' NOT NULL,
	"content_id" text NOT NULL,
	"start_date" text,
	"end_date" text,
	"start_time" text DEFAULT '00:00' NOT NULL,
	"end_time" text DEFAULT '23:59' NOT NULL,
	"days_of_week" text DEFAULT '[0,1,2,3,4,5,6]' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"enabled" integer DEFAULT 1 NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "screens" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"branch_id" text NOT NULL,
	"name" text NOT NULL,
	"playlist_id" text,
	"ticker_id" text,
	"prev_playlist_id" text,
	"orientation" text DEFAULT 'landscape' NOT NULL,
	"resolution" text,
	"os_type" text,
	"app_version" text,
	"location_tag" text,
	"device_token" text,
	"status" text DEFAULT 'offline' NOT NULL,
	"last_sync_at" text,
	"last_seen_at" text,
	"offline_alert_sent" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "screens_device_token_unique" UNIQUE("device_token")
);
--> statement-breakpoint
CREATE TABLE "status_events" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"screen_id" text NOT NULL,
	"kind" text NOT NULL,
	"detail" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"plan" text DEFAULT 'trial' NOT NULL,
	"billing_cycle" text DEFAULT 'monthly' NOT NULL,
	"screen_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'trialing' NOT NULL,
	"payment_method" text,
	"trial_ends_at" text,
	"renews_at" text,
	"gateway" text,
	"gateway_customer_id" text,
	"gateway_subscription_id" text,
	"cancel_at_period_end" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "subscriptions_org_id_unique" UNIQUE("org_id")
);
--> statement-breakpoint
CREATE TABLE "tickers" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"branch_id" text,
	"name" text NOT NULL,
	"text" text NOT NULL,
	"position" text DEFAULT 'bottom' NOT NULL,
	"speed" integer DEFAULT 60 NOT NULL,
	"color" text DEFAULT '#ffffff' NOT NULL,
	"background" text DEFAULT '#111827' NOT NULL,
	"start_time" text,
	"end_time" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transcode_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"media_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"source_path" text,
	"source_key" text,
	"cleanup" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"error" text,
	"locked_by" text,
	"locked_at" text,
	"available_at" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text NOT NULL,
	"branch_ids" text DEFAULT '[]' NOT NULL,
	"totp_secret" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"gateway" text NOT NULL,
	"event_id" text NOT NULL,
	"type" text NOT NULL,
	"org_id" text,
	"status" text DEFAULT 'processed' NOT NULL,
	"payload" text,
	"created_at" text NOT NULL,
	CONSTRAINT "uq_webhook_event" UNIQUE("gateway","event_id")
);
--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_versions" ADD CONSTRAINT "media_versions_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlists" ADD CONSTRAINT "playlists_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlists" ADD CONSTRAINT "playlists_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screens" ADD CONSTRAINT "screens_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screens" ADD CONSTRAINT "screens_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screens" ADD CONSTRAINT "screens_playlist_id_playlists_id_fk" FOREIGN KEY ("playlist_id") REFERENCES "public"."playlists"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screens" ADD CONSTRAINT "screens_ticker_id_tickers_id_fk" FOREIGN KEY ("ticker_id") REFERENCES "public"."tickers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickers" ADD CONSTRAINT "tickers_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickers" ADD CONSTRAINT "tickers_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audit_org_created" ON "audit_logs" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_branches_org" ON "branches" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_invites_org" ON "invites" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_invoices_org_created" ON "invoices" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_media_org" ON "media" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_media_versions_media" ON "media_versions" USING btree ("media_id");--> statement-breakpoint
CREATE INDEX "idx_notifications_org" ON "notifications" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_pairings_device" ON "pairings" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "idx_play_org_created" ON "play_events" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_playlists_org" ON "playlists" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_pub_screen" ON "publish_events" USING btree ("screen_id");--> statement-breakpoint
CREATE INDEX "idx_pub_org_created" ON "publish_events" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_schedules_org" ON "schedules" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_screens_org" ON "screens" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_screens_branch" ON "screens" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "idx_status_screen_created" ON "status_events" USING btree ("screen_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_subs_gateway_sub" ON "subscriptions" USING btree ("gateway_subscription_id");--> statement-breakpoint
CREATE INDEX "idx_tickers_org" ON "tickers" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_tjobs_claim" ON "transcode_jobs" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "idx_tjobs_media" ON "transcode_jobs" USING btree ("media_id");--> statement-breakpoint
CREATE INDEX "idx_users_org" ON "users" USING btree ("org_id");