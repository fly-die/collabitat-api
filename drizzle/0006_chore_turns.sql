CREATE TABLE "task_rotations" (
	"task_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "task_rotations_task_id_member_id_pk" PRIMARY KEY("task_id","member_id")
);
--> statement-breakpoint
ALTER TABLE "task_rotations" ADD CONSTRAINT "task_rotations_task_id_recurring_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."recurring_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_rotations" ADD CONSTRAINT "task_rotations_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;