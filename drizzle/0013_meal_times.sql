CREATE TABLE "meal_times" (
	"household_id" uuid NOT NULL,
	"slot" text NOT NULL,
	"weekday" integer NOT NULL,
	CONSTRAINT "meal_times_household_id_slot_weekday_pk" PRIMARY KEY("household_id","slot","weekday")
);
--> statement-breakpoint
ALTER TABLE "planned_meals" ADD COLUMN "slot" text DEFAULT 'dinner' NOT NULL;--> statement-breakpoint
ALTER TABLE "planned_meals" DROP CONSTRAINT "planned_meals_household_id_date_pk";--> statement-breakpoint
ALTER TABLE "planned_meals" ADD CONSTRAINT "planned_meals_household_id_date_slot_pk" PRIMARY KEY("household_id","date","slot");--> statement-breakpoint
ALTER TABLE "meal_times" ADD CONSTRAINT "meal_times_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;