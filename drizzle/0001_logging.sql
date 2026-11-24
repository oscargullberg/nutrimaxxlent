CREATE TYPE "public"."entry_status" AS ENUM('active', 'undone', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."item_kind" AS ENUM('food', 'recipe', 'dish_adjustment', 'estimate');--> statement-breakpoint
CREATE TYPE "public"."llm_provider" AS ENUM('codex', 'fake');--> statement-breakpoint
CREATE TYPE "public"."meal" AS ENUM('breakfast', 'lunch', 'dinner', 'snack', 'other');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."provenance" AS ENUM('catalog', 'recipe', 'estimate', 'corrected');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('running', 'complete', 'clarification', 'failed');--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"provider" "llm_provider" NOT NULL,
	"model" text,
	"prompt_version" text NOT NULL,
	"tool_calls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tokens" jsonb,
	"latency_ms" integer,
	"status" "run_status" DEFAULT 'running' NOT NULL,
	"error_category" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"role" "message_role" NOT NULL,
	"content" text NOT NULL,
	"parts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"agent_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"archived_at" timestamp with time zone,
	"summary" text,
	"summary_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"profile_id" integer NOT NULL,
	"effective_from" date NOT NULL,
	"kcal" double precision,
	"protein_g" double precision,
	"fat_g" double precision,
	"carbs_g" double precision,
	"fiber_g" double precision,
	CONSTRAINT "goals_profile_id_effective_from_pk" PRIMARY KEY("profile_id","effective_from"),
	CONSTRAINT "goals_nonnegative" CHECK ("goals"."kcal" >= 0 and "goals"."protein_g" >= 0 and "goals"."fat_g" >= 0 and "goals"."carbs_g" >= 0 and "goals"."fiber_g" >= 0)
);
--> statement-breakpoint
CREATE TABLE "log_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" integer DEFAULT 1 NOT NULL,
	"logged_at" timestamp with time zone NOT NULL,
	"meal" "meal" DEFAULT 'other' NOT NULL,
	"raw_text" text NOT NULL,
	"source_message_id" uuid,
	"status" "entry_status" DEFAULT 'active' NOT NULL,
	"confidence" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "log_entries_confidence_range" CHECK ("log_entries"."confidence" between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE "log_entry_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"kind" "item_kind" NOT NULL,
	"food_id" uuid,
	"recipe_id" uuid,
	"label" text NOT NULL,
	"quantity" double precision NOT NULL,
	"unit" text NOT NULL,
	"grams" double precision NOT NULL,
	"provenance" "provenance" NOT NULL,
	"confidence" double precision NOT NULL,
	"assumptions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"resolution" jsonb NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "log_entry_items_amounts_positive" CHECK ("log_entry_items"."quantity" > 0 and "log_entry_items"."grams" > 0),
	CONSTRAINT "log_entry_items_confidence_range" CHECK ("log_entry_items"."confidence" between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE "log_entry_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"action" text NOT NULL,
	"previous" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "log_item_nutrients" (
	"item_id" uuid NOT NULL,
	"nutrient_id" text NOT NULL,
	"amount" double precision,
	"unit" text NOT NULL,
	"is_estimate" boolean DEFAULT false NOT NULL,
	CONSTRAINT "log_item_nutrients_item_id_nutrient_id_pk" PRIMARY KEY("item_id","nutrient_id"),
	CONSTRAINT "log_item_nutrients_amount_nonnegative" CHECK ("log_item_nutrients"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"timezone" text DEFAULT 'Europe/Stockholm' NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"auto_commit" boolean DEFAULT true NOT NULL,
	"estimate_kcal_threshold" double precision DEFAULT 200 NOT NULL,
	"provider" "llm_provider",
	"model" text,
	CONSTRAINT "profiles_singleton" CHECK ("profiles"."id" = 1),
	CONSTRAINT "profiles_estimate_threshold_nonnegative" CHECK ("profiles"."estimate_kcal_threshold" >= 0)
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_thread_id_chat_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."chat_threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_thread_id_chat_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."chat_threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "log_entries" ADD CONSTRAINT "log_entries_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "log_entries" ADD CONSTRAINT "log_entries_source_message_id_chat_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."chat_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "log_entry_items" ADD CONSTRAINT "log_entry_items_entry_id_log_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."log_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "log_entry_items" ADD CONSTRAINT "log_entry_items_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "log_entry_items" ADD CONSTRAINT "log_entry_items_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "log_entry_revisions" ADD CONSTRAINT "log_entry_revisions_entry_id_log_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."log_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "log_item_nutrients" ADD CONSTRAINT "log_item_nutrients_item_id_log_entry_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."log_entry_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "log_item_nutrients" ADD CONSTRAINT "log_item_nutrients_nutrient_id_nutrients_id_fk" FOREIGN KEY ("nutrient_id") REFERENCES "public"."nutrients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_runs_thread_idx" ON "agent_runs" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "chat_messages_thread_created_idx" ON "chat_messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "chat_messages_run_idx" ON "chat_messages" USING btree ("agent_run_id");--> statement-breakpoint
CREATE INDEX "log_entries_profile_logged_idx" ON "log_entries" USING btree ("profile_id","logged_at");--> statement-breakpoint
CREATE INDEX "log_entries_source_message_idx" ON "log_entries" USING btree ("source_message_id");--> statement-breakpoint
CREATE INDEX "log_entry_items_entry_idx" ON "log_entry_items" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "log_entry_items_food_idx" ON "log_entry_items" USING btree ("food_id");--> statement-breakpoint
CREATE INDEX "log_entry_items_recipe_idx" ON "log_entry_items" USING btree ("recipe_id");--> statement-breakpoint
CREATE INDEX "log_entry_revisions_entry_idx" ON "log_entry_revisions" USING btree ("entry_id","created_at");--> statement-breakpoint
CREATE INDEX "log_item_nutrients_nutrient_idx" ON "log_item_nutrients" USING btree ("nutrient_id");