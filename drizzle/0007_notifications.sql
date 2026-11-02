CREATE TABLE "chore_reminders_sent" (
	"member_id" uuid NOT NULL,
	"sent_on" date NOT NULL,
	CONSTRAINT "chore_reminders_sent_member_id_sent_on_pk" PRIMARY KEY("member_id","sent_on")
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"endpoint" text PRIMARY KEY NOT NULL,
	"member_id" uuid NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chore_reminders_sent" ADD CONSTRAINT "chore_reminders_sent_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;