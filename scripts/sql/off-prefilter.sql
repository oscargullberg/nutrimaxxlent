COPY (
  WITH candidates AS (
    SELECT
      code AS barcode,
      coalesce(
        list_extract(list_filter(product_name, x -> x.lang = 'sv' AND length(trim(x.text)) > 0), 1).text,
        list_extract(list_filter(product_name, x -> x.lang = 'main' AND length(trim(x.text)) > 0), 1).text,
        list_extract(list_filter(product_name, x -> length(trim(x.text)) > 0), 1).text
      ) AS name,
      list_extract(list_filter(product_name, x -> x.lang = 'en' AND length(trim(x.text)) > 0), 1).text AS name_en,
      nullif(trim(brands), '') AS brand,
      quantity,
      serving_size,
      nova_group,
      list_filter(nutriments, x -> x.name IN (
        'energy-kcal', 'energy-kj', 'proteins', 'fat', 'saturated-fat',
        'carbohydrates', 'sugars', 'fiber', 'salt', 'sodium', 'calcium',
        'potassium', 'iron', 'vitamin-c', 'vitamin-d',
        'monounsaturated-fat', 'polyunsaturated-fat', 'trans-fat', 'alpha-linolenic-acid',
        'eicosapentaenoic-acid', 'docosahexaenoic-acid', 'linoleic-acid', 'added-sugars',
        'vitamin-b1', 'vitamin-b2', 'vitamin-pp', 'pantothenic-acid', 'vitamin-b6',
        'biotin', 'vitamin-b12', 'vitamin-e', 'vitamin-k', 'magnesium', 'phosphorus',
        'zinc', 'selenium', 'iodine', 'copper', 'manganese'
      ) AND isfinite(x."100g") AND x."100g" >= 0) AS nutrients,
      rev
    FROM read_parquet(getvariable('input_path'))
    WHERE list_contains(countries_tags, 'en:sweden')
      AND NOT coalesce(obsolete, false)
      AND NOT coalesce(no_nutrition_data, false)
      AND coalesce(lower(product_quantity_unit), '') NOT IN ('ml', 'cl', 'dl', 'l', 'fl oz')
      AND NOT regexp_matches(coalesce(lower(serving_size), ''), '[0-9][ ]*(ml|cl|dl|l)([^a-z]|$)')
      AND regexp_full_match(code, '[0-9]{4,24}')
  )
  SELECT * EXCLUDE (rev)
  FROM candidates
  WHERE name IS NOT NULL AND len(nutrients) > 0
  QUALIFY row_number() OVER (PARTITION BY barcode ORDER BY rev DESC NULLS LAST, name) = 1
  ORDER BY barcode
) TO (getvariable('output_path')) (FORMAT JSON, ARRAY false);
