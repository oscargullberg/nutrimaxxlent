import { z } from 'zod';
import { canonicalNutrients } from '../../nutrition-reference.ts';
import { ingredientEvidence } from '../nutrition/ingredient-evidence.ts';

const name = z.string().trim().min(1).max(200);
const grams = z.number().positive().max(5000);

export const productEvidence = z.object({
  product: z
    .object({
      name,
      brand: name,
      barcode: z
        .string()
        .regex(/^\d{8,14}$/u)
        .nullable(),
      sourceUrl: z.string().min(1).max(2000),
      referenceGrams: grams,
      volume: z
        .object({ ml: z.number().positive().max(5000), weightEstimated: z.boolean() })
        .nullable(),
      nutrients: z
        .array(
          z.object({
            id: z.enum(canonicalNutrients.map(({ id }) => id)),
            amount: z.number().nonnegative()
          })
        )
        .min(1)
        .max(canonicalNutrients.length),
      piece: z.object({ grams, label: name }).nullable(),
      ingredients: ingredientEvidence.nullable()
    })
    .nullable(),
  alternatives: z.array(name).max(5)
});

export type ProductEvidence = z.infer<typeof productEvidence>;
