CREATE TABLE "notification_mutes" (
	"member_id" uuid NOT NULL,
	"topic" text NOT NULL,
	CONSTRAINT "notification_mutes_member_id_topic_pk" PRIMARY KEY("member_id","topic")
);
--> statement-breakpoint
ALTER TABLE "notification_mutes" ADD CONSTRAINT "notification_mutes_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;