CREATE TABLE "product_ingredients" (
	"food_id" uuid PRIMARY KEY NOT NULL,
	"food_version" text NOT NULL,
	"evidence" jsonb,
	"source_url" text,
	"label_nutrients" jsonb,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_ingredients" ADD CONSTRAINT "product_ingredients_food_id_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."foods"("id") ON DELETE cascade ON UPDATE no action;