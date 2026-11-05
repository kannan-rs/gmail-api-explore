ALTER TABLE "email_sends" ADD COLUMN "deferred_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_sends" ADD COLUMN "last_deferred_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_sends" ADD COLUMN "deferred_count" integer DEFAULT 0 NOT NULL;