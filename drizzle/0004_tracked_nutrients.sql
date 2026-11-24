INSERT INTO "nutrients" ("id", "name", "unit", "eurofir_code", "category", "display_order")
VALUES
  ('added_sugars_g', 'Added sugars', 'g', 'SUGAD', 'macro', 15),
  ('monounsaturated_fat_g', 'Monounsaturated fat', 'g', 'FAMS', 'fat', 16),
  ('polyunsaturated_fat_g', 'Polyunsaturated fat', 'g', 'FAPU', 'fat', 17),
  ('trans_fat_g', 'Trans fat', 'g', NULL, 'fat', 18),
  ('omega3_ala_g', 'Omega-3 ALA', 'g', NULL, 'fat', 19),
  ('omega3_epa_mg', 'Omega-3 EPA', 'mg', 'F20:5', 'fat', 20),
  ('omega3_dha_mg', 'Omega-3 DHA', 'mg', 'F22:6', 'fat', 21),
  ('omega6_la_g', 'Omega-6 LA', 'g', 'F18:2', 'fat', 22),
  ('vitamin_a_ug_rae', 'Vitamin A', 'µg RAE', 'VITA', 'vitamin', 23),
  ('vitamin_b1_mg', 'Vitamin B1 (Thiamin)', 'mg', 'THIACLHCL', 'vitamin', 24),
  ('vitamin_b2_mg', 'Vitamin B2 (Riboflavin)', 'mg', 'RIBF', 'vitamin', 25),
  ('vitamin_b3_mg', 'Vitamin B3 (Niacin)', 'mg', 'NIA', 'vitamin', 26),
  ('vitamin_b5_mg', 'Vitamin B5 (Pantothenic acid)', 'mg', NULL, 'vitamin', 27),
  ('vitamin_b6_mg', 'Vitamin B6', 'mg', 'VITB6', 'vitamin', 28),
  ('vitamin_b7_ug', 'Vitamin B7 (Biotin)', 'µg', NULL, 'vitamin', 29),
  ('vitamin_b9_ug', 'Vitamin B9 (Folate)', 'µg', 'FOL', 'vitamin', 30),
  ('vitamin_b12_ug', 'Vitamin B12', 'µg', 'VITB12', 'vitamin', 31),
  ('vitamin_e_mg', 'Vitamin E', 'mg', 'VITE', 'vitamin', 32),
  ('vitamin_k_ug', 'Vitamin K', 'µg', NULL, 'vitamin', 33),
  ('magnesium_mg', 'Magnesium', 'mg', 'MG', 'mineral', 34),
  ('phosphorus_mg', 'Phosphorus', 'mg', 'P', 'mineral', 35),
  ('zinc_mg', 'Zinc', 'mg', 'ZN', 'mineral', 36),
  ('selenium_ug', 'Selenium', 'µg', 'SE', 'mineral', 37),
  ('iodine_ug', 'Iodine', 'µg', 'ID', 'mineral', 38),
  ('copper_mg', 'Copper', 'mg', NULL, 'mineral', 39),
  ('manganese_mg', 'Manganese', 'mg', NULL, 'mineral', 40)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
UPDATE "nutrients" SET "category" = 'fat' WHERE "id" = 'saturated_fat_g';
--> statement-breakpoint
UPDATE "nutrients" SET "name" = 'Total sugars' WHERE "id" = 'sugars_g';
--> statement-breakpoint
UPDATE "nutrients" SET "name" = 'Fibre' WHERE "id" = 'fiber_g';
