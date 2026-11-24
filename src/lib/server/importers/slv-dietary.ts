import { foodGroupIds, type FoodGroup, type NovaGroup } from '../../food-groups.ts';
import { unknownDietary, withNova, type DietaryAmounts } from '../nutrition/dietary.ts';

type Classification = { fasett?: string | null; namn?: string | null };

const vegetableCategories = new Set(['Grönsaker och svamp', 'Grönsaker, rotfrukter och svamp']);
const oilySpecies = /^(?:lax|regnbågslax|sill|strömming|makrill|skarpsill|röding|ål|öring)$/iu;
const mammal = /^(?:ko|nötkreatur|kalv|gris|får|lamm|get|häst|ren|älg|rådjur|vildsvin)$/iu;
const minimalProcesses = new Set([
  'Ingen industriell process tillämpad',
  'Vatten borttaget',
  'Vatten tillfört',
  'Rehydrerad'
]);

export function slvFacet(classifications: readonly Classification[], facet: string) {
  return classifications.flatMap(({ fasett, namn }) =>
    fasett?.startsWith(facet + ' ') && namn ? [namn.trim()] : []
  );
}

export function classifySlvLeaf(
  name: string,
  classifications: readonly Classification[],
  cookedGrams: number,
  rawGrams: number | null
): DietaryAmounts {
  const [category] = slvFacet(classifications, 'A');
  const species = slvFacet(classifications, 'B');
  const processing = slvFacet(classifications, 'H');
  const result = unknownDietary(cookedGrams);
  const groups = result.groups;

  function setKnown(contributions: Partial<Record<FoodGroup, number>>) {
    for (const id of foodGroupIds) groups[id] = { grams: contributions[id] ?? 0 };
    result.groupsKnown = true;
  }

  if (category === 'Kaffe, te och kakao' && name === 'Kaffe bryggt') {
    setKnown({});
    return withNova(result, cookedGrams, 1, 'Livsmedelsverket catalog rules');
  }

  let nova: NovaGroup | undefined;
  const culinary =
    species.includes('Koksalt') ||
    category === 'Smör' ||
    category === 'Socker, honung eller sirap' ||
    (category === 'Vegetabiliskt fett och olja' && /olja$/iu.test(name.trim()));
  const processedMeat =
    category === 'Konserverat kött' ||
    (category === 'Korv eller liknande produkt' &&
      /korv/iu.test(name) &&
      (species.some((item) => mammal.test(item)) ||
        species.some((item) => /^(kyckling|kalkon)$/iu.test(item))));
  const plainFish = category === 'Fisk' && !/\b(?:m\.|i|olika smaker)\s|rom\b/iu.test(name);
  const fishProduct =
    category === 'Fisk- och skaldjursprodukt' &&
    /\b(?:kallrökt|varmrökt|grav(ad|at)|inlagd u\. lag)\b/iu.test(name) &&
    !/\bm\.\s/iu.test(name);
  const knownVegetable =
    vegetableCategories.has(category ?? '') || /^(?:Vitlök|Persilja blad|Dill färsk)$/iu.test(name);
  const knownLegume = category === 'Baljväxter' && !/\bm\. (?!salt)|rullpack|ärtskott/iu.test(name);
  const knownNut =
    category === 'Nöt, frö eller kärna' ||
    (category === 'Nöt eller frö produkt' &&
      /^(?:cashewnötter|jordnötter|linfrö|pistaschnötter|pumpafrö|sesamfrö|solrosfrö|sötmandel|kastanjer|pinjefrö|chiafrö|hampafrö|vallmofrö|macadamianötter)\b/iu.test(
        name
      ));
  const wholeKernel = slvFacet(classifications, 'C').includes('Hela frön, fullkorn, gryn, bönor');
  const wholeGrain = /fullkorn|\bråris\b/iu.test(name) || name === 'Bulgur';

  if (processedMeat) {
    groups.processedMeat = { grams: cookedGrams };
    if (species.some((item) => mammal.test(item))) {
      const meatPercent = name.match(
        /\bkött (?:ca )?(\d+(?:[.,]\d+)?)(?:[-–](\d+(?:[.,]\d+)?))?\s*%/iu
      );
      if (meatPercent && species.every((item) => mammal.test(item))) {
        const fraction = Number(meatPercent[1]!.replace(',', '.')) / 100;
        if (fraction <= 1) {
          groups.redMeat = {
            grams: cookedGrams * fraction,
            ...(meatPercent[2] ? { partial: true } : {})
          };
        }
      } else if (category === 'Konserverat kött' && !/\b(?:gelé|m\.)\s/iu.test(name)) {
        setKnown({ processedMeat: cookedGrams, redMeat: cookedGrams });
      }
    } else {
      groups.redMeat = { grams: 0 };
    }
  } else if (knownVegetable) {
    setKnown({ vegetables: cookedGrams });
  } else if (category === 'Frukt och bär') {
    setKnown({ fruitAndBerries: cookedGrams });
  } else if (knownLegume) {
    setKnown({ legumes: cookedGrams });
  } else if (knownNut) {
    setKnown({ nutsAndSeeds: cookedGrams });
  } else if (plainFish || fishProduct) {
    const oily =
      species.some((item) => oilySpecies.test(item)) ||
      /^(?:ansjovis skarpsill|böckling|regnbågslax|pinklax)\b/iu.test(name);
    setKnown({ oilyFish: oily ? cookedGrams : 0 });
  } else if (category === 'Rött kött') {
    setKnown({ redMeat: cookedGrams });
  } else if (
    wholeGrain &&
    (category === 'Ris eller annat spannmål' ||
      category === 'Cerealier eller cerealielika mjölprodukter och derivat') &&
    (wholeKernel || /^(?:bulgur|\w+mjöl)\b/iu.test(name)) &&
    !/\b(?:kokt|tillagad|riskaka)\b|\bm\.\s/iu.test(name)
  ) {
    setKnown({ wholeGrains: rawGrams ?? 0 });
    if (rawGrams === null) groups.wholeGrains = { grams: 0, partial: true };
  } else if (
    culinary ||
    [
      'Ägg',
      'Mjölk',
      'Vatten',
      'Potatis och stärkelserika rötter',
      'Hårdost',
      'Lagrad ost'
    ].includes(category ?? '') ||
    (category === 'Fågel' && processing.every((process) => minimalProcesses.has(process)))
  ) {
    setKnown({});
  }

  if (culinary) nova = 2;
  else if (
    !processedMeat &&
    !fishProduct &&
    Object.keys(groups).length === foodGroupIds.length &&
    processing.length > 0 &&
    processing.every((process) => minimalProcesses.has(process)) &&
    !['Hårdost', 'Lagrad ost'].includes(category ?? '')
  )
    nova = 1;

  return withNova(result, cookedGrams, nova, nova ? 'Livsmedelsverket catalog rules' : undefined);
}
