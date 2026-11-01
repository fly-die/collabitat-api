CREATE TABLE "recurring_tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"title" text NOT NULL,
	"interval_count" integer NOT NULL,
	"interval_unit" text NOT NULL,
	"first_due_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_completions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"task_id" uuid NOT NULL,
	"member_id" uuid,
	"done_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recurring_tasks" ADD CONSTRAINT "recurring_tasks_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_completions" ADD CONSTRAINT "task_completions_task_id_recurring_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."recurring_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_completions" ADD CONSTRAINT "task_completions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recurring_tasks_household_id_idx" ON "recurring_tasks" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "task_completions_task_id_idx" ON "task_completions" USING btree ("task_id");