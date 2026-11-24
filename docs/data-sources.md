# Food data sources

Run the database setup in [Data model](data-model.md) before importing. Downloads go under `DATA_DIR` (`./data` by default). Import reads the local files and can run offline.

| Source | Contents                                                                                       | License and attribution                                                                                                                                  |
| ------ | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `slv`  | Swedish and English food names, nutrients, classifications, and calculated dish components     | CC BY 4.0. Swedish Food Agency, Swedish Food Composition Database. [Source](https://www.livsmedelsverket.se/en/about-us/open-data/food-composition-data) |
| `fdc`  | USDA Foundation Foods, SR Legacy, and FNDDS, including published portions                      | CC0 1.0. USDA Agricultural Research Service, FoodData Central. [Source](https://fdc.nal.usda.gov/download-datasets/)                                     |
| `off`  | Open Food Facts products tagged as sold in Sweden and filtered for usable mass-based nutrition | ODbL 1.0. Open Food Facts contributors. [Source](https://huggingface.co/datasets/openfoodfacts/product-database)                                         |

```sh
pnpm data:download slv
pnpm ingest slv
pnpm data:refresh slv
```

Use `fdc` or `off` in the same commands for those sources. USDA downloads require `unzip`. Open Food Facts requires DuckDB on `PATH` and several gigabytes of free disk space. Its downloaded `food.parquet` is filtered to `data/off/sweden.ndjson`. The import excludes products with volume-based packaging or serving information where the label may report nutrients per 100 mL.

Refresh runs download followed by import. Imports report processed, inserted, updated, and unchanged food counts. Stable source IDs are reused across versions, and a failed import rolls back catalog writes while recording the failed attempt. Historical log snapshots keep the nutrient amounts captured when the entry was committed.

After upgrading an existing install, run `pnpm db:migrate` and reimport the cached SLV and FDC
datasets with `pnpm ingest slv` and `pnpm ingest fdc`. If you use Open Food Facts, run
`pnpm data:refresh off` to rebuild its filtered export and import it.
Nutrient coverage varies by food and source. Livsmedelsverket reports combined C18:3, so ALA
uses fields that identify ALA specifically. See the [Swedish Food Agency nutrient definitions](https://www.livsmedelsverket.se/livsmedel-och-innehall/naringsamne/livsmedelsdatabasen/sok-naringsinnehall/ordlista-for-sok-naringsinnehall/naringsamnen/).

Food-group totals use Livsmedelsverket classifications and weighted dish ingredients. For USDA
FNDDS foods, the importer links the survey reference recipe to catalog foods using USDA ingredient
codes and rolls up identifiable ingredients. Component weights from recipes with a published
moisture adjustment allocate that change proportionally. Whole grains use dry grain weight where
it is known. Other groups use edible weights from the source or a saved recipe. Cured pork can
contribute to both red meat and processed meat. NOVA uses Open Food Facts product groups where
available and conservative Livsmedelsverket rules for identifiable foods. When an ingredient
or weight lacks enough detail, Today shows incomplete coverage.

Run `pnpm ingest fdc --backfill-dietary` to reimport cached USDA data and fill missing classification
snapshots on existing unadjusted catalog foods. Use the same flag with `slv` for Swedish foods.
The backfill preserves existing food-group and NOVA snapshots when present and records the
catalog revision used. It updates dietary data only, so saved nutrients and serving weights
remain as logged.

`GET /api/meta/sources` exposes each successfully imported source, including license, attribution, version, and import time. If you redistribute an imported or derived Open Food Facts database, review the [ODbL terms](https://opendatacommons.org/licenses/odbl/1-0/).
