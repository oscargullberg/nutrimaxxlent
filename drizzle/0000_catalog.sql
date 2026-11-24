CREATE TYPE "public"."dataset_status" AS ENUM('running', 'complete', 'failed');--> statement-breakpoint
CREATE TYPE "public"."food_kind" AS ENUM('generic', 'branded', 'dish', 'custom');--> statement-breakpoint
CREATE TYPE "public"."unit_dimension" AS ENUM('mass', 'volume');--> statement-breakpoint
CREATE TABLE "dataset_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"version" text NOT NULL,
	"status" "dataset_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"stats" jsonb,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "food_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"food_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"language" text DEFAULT 'und' NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "food_aliases_identity_key" UNIQUE("food_id","alias","language","source")
);
--> statement-breakpoint
CREATE TABLE "food_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_food_id" uuid NOT NULL,
	"child_food_id" uuid,
	"name" text NOT NULL,
	"amount_g" double precision,
	"raw_amount_g" double precision,
	"depth" integer NOT NULL,
	"sort_order" integer NOT NULL,
	CONSTRAINT "food_components_order_key" UNIQUE("parent_food_id","sort_order"),
	CONSTRAINT "food_components_weights_nonnegative" CHECK ("food_components"."amount_g" >= 0 and "food_components"."raw_amount_g" >= 0),
	CONSTRAINT "food_components_depth_nonnegative" CHECK ("food_components"."depth" >= 0)
);
--> statement-breakpoint
CREATE TABLE "food_nutrients" (
	"food_id" uuid NOT NULL,
	"nutrient_id" text NOT NULL,
	"amount" double precision,
	"unit" text NOT NULL,
	"is_derived" boolean DEFAULT false NOT NULL,
	"source_meta" jsonb,
	CONSTRAINT "food_nutrients_food_id_nutrient_id_pk" PRIMARY KEY("food_id","nutrient_id"),
	CONSTRAINT "food_nutrients_amount_nonnegative" CHECK ("food_nutrients"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "food_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"license" text NOT NULL,
	"attribution" text NOT NULL,
	"homepage" text NOT NULL,
	"version" text,
	"last_imported_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "foods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"source_food_id" text NOT NULL,
	"kind" "food_kind" NOT NULL,
	"name" text NOT NULL,
	"name_en" text,
	"brand" text,
	"barcode" text,
	"category" text,
	"source_version" text NOT NULL,
	"search_text" text NOT NULL,
	"density_g_per_ml" double precision,
	"classification" jsonb,
	"favorite" boolean DEFAULT false NOT NULL,
	CONSTRAINT "foods_source_identity_key" UNIQUE("source_id","source_food_id"),
	CONSTRAINT "foods_density_positive" CHECK ("foods"."density_g_per_ml" > 0)
);
--> statement-breakpoint
CREATE TABLE "nutrients" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"unit" text NOT NULL,
	"eurofir_code" text,
	"category" text NOT NULL,
	"display_order" integer NOT NULL,
	"is_core" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"food_id" uuid NOT NULL,
	"label" text NOT NULL,
	"grams" double precision NOT NULL,
	"unit" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "portions_identity_key" UNIQUE("food_id","source","unit","label"),
	CONSTRAINT "portions_grams_positive" CHECK ("portions"."grams" > 0)
);
--> statement-breakpoint
CREATE TABLE "recipe_ingredients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipe_id" uuid NOT NULL,
	"food_id" uuid,
	"sub_recipe_id" uuid,
	"name" text NOT NULL,
	"quantity" double precision NOT NULL,
	"unit" text NOT NULL,
	"grams" double precision NOT NULL,
	"optional" boolean DEFAULT false NOT NULL,
	"sort_order" integer NOT NULL,
	CONSTRAINT "recipe_ingredients_order_key" UNIQUE("recipe_id","sort_order"),
	CONSTRAINT "recipe_ingredients_one_reference" CHECK (num_nonnulls("recipe_ingredients"."food_id", "recipe_ingredients"."sub_recipe_id") = 1),
	CONSTRAINT "recipe_ingredients_no_self_reference" CHECK ("recipe_ingredients"."recipe_id" <> "recipe_ingredients"."sub_recipe_id"),
	CONSTRAINT "recipe_ingredients_amounts_positive" CHECK ("recipe_ingredients"."quantity" > 0 and "recipe_ingredients"."grams" > 0)
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"servings" double precision NOT NULL,
	"total_weight_g" double precision,
	"instructions" text,
	"search_text" text NOT NULL,
	CONSTRAINT "recipes_servings_positive" CHECK ("recipes"."servings" > 0),
	CONSTRAINT "recipes_weight_positive" CHECK ("recipes"."total_weight_g" > 0)
);
--> statement-breakpoint
CREATE TABLE "unit_conversions" (
	"unit" text PRIMARY KEY NOT NULL,
	"dimension" "unit_dimension" NOT NULL,
	"factor_to_base" double precision NOT NULL,
	CONSTRAINT "unit_conversion_factor_positive" CHECK ("unit_conversions"."factor_to_base" > 0)
);
--> statement-breakpoint
ALTER TABLE "dataset_runs" ADD CONSTRAINT "dataset_runs_source_id_food_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."food_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_aliases" ADD CONSTRAINT "food_aliases_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_components" ADD CONSTRAINT "food_components_parent_food_id_foods_id_fk" FOREIGN KEY ("parent_food_id") REFERENCES "public"."foods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_components" ADD CONSTRAINT "food_components_child_food_id_foods_id_fk" FOREIGN KEY ("child_food_id") REFERENCES "public"."foods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_nutrients" ADD CONSTRAINT "food_nutrients_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_nutrients" ADD CONSTRAINT "food_nutrients_nutrient_id_nutrients_id_fk" FOREIGN KEY ("nutrient_id") REFERENCES "public"."nutrients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foods" ADD CONSTRAINT "foods_source_id_food_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."food_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portions" ADD CONSTRAINT "portions_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_sub_recipe_id_recipes_id_fk" FOREIGN KEY ("sub_recipe_id") REFERENCES "public"."recipes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dataset_runs_source_started_idx" ON "dataset_runs" USING btree ("source_id","started_at");--> statement-breakpoint
CREATE INDEX "food_aliases_alias_idx" ON "food_aliases" USING btree ("alias");--> statement-breakpoint
CREATE INDEX "food_components_child_idx" ON "food_components" USING btree ("child_food_id");--> statement-breakpoint
CREATE INDEX "food_nutrients_nutrient_idx" ON "food_nutrients" USING btree ("nutrient_id");--> statement-breakpoint
CREATE INDEX "foods_barcode_idx" ON "foods" USING btree ("barcode") WHERE "foods"."barcode" is not null;--> statement-breakpoint
CREATE INDEX "recipe_ingredients_food_idx" ON "recipe_ingredients" USING btree ("food_id");--> statement-breakpoint
CREATE INDEX "recipe_ingredients_sub_recipe_idx" ON "recipe_ingredients" USING btree ("sub_recipe_id");