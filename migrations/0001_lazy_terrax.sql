CREATE TABLE "tracking_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"send_id" uuid NOT NULL,
	"tracking_id" text NOT NULL,
	"event_type" text NOT NULL,
	"source" text NOT NULL,
	"provider_event_id" text DEFAULT '' NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_sends" ADD COLUMN "tracking_id" text;--> statement-breakpoint
UPDATE "email_sends" SET "tracking_id" = 'trk_' || replace(gen_random_uuid()::text, '-', '') WHERE "tracking_id" IS NULL;--> statement-breakpoint
ALTER TABLE "email_sends" ALTER COLUMN "tracking_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "email_sends" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_sends" ADD COLUMN "bounced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_sends" ADD COLUMN "bounce_type" text;--> statement-breakpoint
ALTER TABLE "email_sends" ADD COLUMN "opened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_sends" ADD COLUMN "last_opened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_sends" ADD COLUMN "open_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "email_sends" ADD COLUMN "read_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_sends" ADD COLUMN "acknowledged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_sends" ADD COLUMN "replied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_sends" ADD COLUMN "complained_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tracking_events" ADD CONSTRAINT "tracking_events_send_id_email_sends_id_fk" FOREIGN KEY ("send_id") REFERENCES "public"."email_sends"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tracking_events_send_created_idx" ON "tracking_events" USING btree ("send_id","created_at");--> statement-breakpoint
CREATE INDEX "tracking_events_tracking_id_idx" ON "tracking_events" USING btree ("tracking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tracking_events_dedupe_unique" ON "tracking_events" USING btree ("send_id","event_type","source","provider_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_sends_tracking_id_unique" ON "email_sends" USING btree ("tracking_id");