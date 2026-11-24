// Livsmedelsverket food numbers, with editable serving estimates in grams.
const crispbread = { id: '190', grams: 12, serving: 'en skiva knäckebröd' } as const;

export const swedishDefaults = {
  knackebrod: crispbread,
  knackerbrod: crispbread,
  'hart brod': crispbread,
  ost: { id: '96', grams: 10, serving: 'en skiva hårdost' },
  smor: { id: '29', grams: 4, serving: 'smör till en smörgås' },
  salami: { id: '1498', grams: 6, serving: 'salami till en smörgås' },
  apple: { id: '588', grams: 150, serving: 'ett äpple' },
  kaffe: { id: '1957', grams: 150, serving: 'en kopp svart bryggkaffe' }
} as const;

export function swedishDefault(query: string) {
  return Object.hasOwn(swedishDefaults, query)
    ? swedishDefaults[query as keyof typeof swedishDefaults]
    : undefined;
}
