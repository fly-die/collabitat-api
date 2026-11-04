CREATE TABLE "shopping_checks" (
	"household_id" uuid NOT NULL,
	"week_from" date NOT NULL,
	"item_key" text NOT NULL,
	CONSTRAINT "shopping_checks_household_id_week_from_item_key_pk" PRIMARY KEY("household_id","week_from","item_key")
);
--> statement-breakpoint
CREATE TABLE "shopping_trips" (
	"household_id" uuid PRIMARY KEY NOT NULL,
	"shopper_member_id" uuid NOT NULL,
	"week_from" date NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shopping_checks" ADD CONSTRAINT "shopping_checks_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_trips" ADD CONSTRAINT "shopping_trips_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_trips" ADD CONSTRAINT "shopping_trips_shopper_member_id_members_id_fk" FOREIGN KEY ("shopper_member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;