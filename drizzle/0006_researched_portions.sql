ALTER TABLE "portions" ADD COLUMN "source_url" text;
--> statement-breakpoint
INSERT INTO "portions" ("food_id", "label", "grams", "unit", "is_default", "source", "source_url")
SELECT "id", 'Typical piece', 40, 'st', true, 'web',
  'https://www.delicato.se/vara-bakverk/Kondisbitar/Delicatoboll-6-p---1363'
FROM "foods" WHERE "source_id" = 'slv' AND "source_food_id" = '1657'
ON CONFLICT ("food_id", "source", "unit", "label") DO NOTHING;
