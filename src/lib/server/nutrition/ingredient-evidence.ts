import { z } from 'zod';

const ingredientName = z.string().trim().min(1).max(160);

export const ingredientEvidence = z.object({
  text: z.string().trim().min(1).max(5000),
  orderedByWeight: z.boolean(),
  components: z
    .array(
      z.object({
        name: ingredientName,
        catalogNames: z.array(ingredientName).max(3),
        percent: z.number().positive().max(100).nullable()
      })
    )
    .min(1)
    .max(20)
});

export type IngredientEvidence = z.infer<typeof ingredientEvidence>;

export const ingredientEvidenceInstructions = `Keep the original ingredient declaration verbatim in text. Include every top-level component, including water and minor ingredients. Keep compound ingredients (e.g. tortilla or mayonnaise) as single components and avoid counting any subingredient twice. For each component give its label name and up to three generic catalog search names in Swedish or English, most specific first, reflecting how the component is eaten (e.g. cooked chicken breast). Use percent only for an explicitly documented percentage of the whole finished product by weight. Set orderedByWeight only when the list is known to reflect weight order on a comparable basis. Supply the declaration only when you can represent the whole list faithfully.`;
