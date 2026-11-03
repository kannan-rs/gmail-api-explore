CREATE TABLE "clients" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_send_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"send_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text DEFAULT 'gmail' NOT NULL,
	"mode" text DEFAULT 'direct' NOT NULL,
	"mailbox_id" uuid,
	"client_id" text NOT NULL,
	"from_email" text NOT NULL,
	"to_emails" text[] NOT NULL,
	"cc_emails" text[] NOT NULL,
	"bcc_emails" text[] NOT NULL,
	"subject" text NOT NULL,
	"body_html" text,
	"body_text" text,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"message_id_header" text NOT NULL,
	"provider_message_id" text,
	"provider_thread_id" text,
	"provider_labels" text[],
	"status" text DEFAULT 'SENDING' NOT NULL,
	"error_code" text,
	"error_message" text,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"sent_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mailboxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mailbox_id" uuid NOT NULL,
	"refresh_token_encrypted" text NOT NULL,
	"scopes" text[] NOT NULL,
	"token_type" text DEFAULT 'Bearer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_send_events" ADD CONSTRAINT "email_send_events_send_id_email_sends_id_fk" FOREIGN KEY ("send_id") REFERENCES "public"."email_sends"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_sends" ADD CONSTRAINT "email_sends_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_sends" ADD CONSTRAINT "email_sends_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_credentials" ADD CONSTRAINT "oauth_credentials_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_send_events_send_created_idx" ON "email_send_events" USING btree ("send_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "email_sends_idempotency_key_unique" ON "email_sends" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "email_sends_message_id_header_unique" ON "email_sends" USING btree ("message_id_header");--> statement-breakpoint
CREATE INDEX "email_sends_client_created_at_idx" ON "email_sends" USING btree ("client_id","created_at");--> statement-breakpoint
CREATE INDEX "email_sends_status_created_at_idx" ON "email_sends" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "email_sends_provider_message_id_idx" ON "email_sends" USING btree ("provider_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mailboxes_provider_email_unique" ON "mailboxes" USING btree ("provider","email");--> statement-breakpoint
CREATE INDEX "mailboxes_email_idx" ON "mailboxes" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_credentials_mailbox_unique" ON "oauth_credentials" USING btree ("mailbox_id");