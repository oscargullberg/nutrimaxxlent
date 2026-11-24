import type {
  ClarificationAnswer,
  PendingClarification,
  ReviewReplacement
} from '../server/agent/clarify';
import type { Proposal } from '../server/agent/proposal';
import type { ProviderStatus } from '../server/agent/provider';
import type { ResolvedItem } from '../server/agent/resolve';
import type { foodSources } from '../server/db/schema';
import type { FoodSearchResult, getFood } from '../server/services/catalog';
import type { getEntry } from '../server/services/entries';
import type { getRecipe, searchRecipes } from '../server/services/recipes';
import type { HistoryMatch } from '../server/services/search';
import type { providerConfig, readSettings } from '../server/services/settings';
import type { createThread, messagesForThread } from '../server/services/threads';
import type { dayTotals } from '../server/services/totals';

type Json<T> = T extends Date
  ? string
  : T extends readonly (infer Item)[]
    ? Json<Item>[]
    : T extends object
      ? { [Key in keyof T]: Json<T[Key]> }
      : T;

type Row<T> = Json<NonNullable<Awaited<T>>>;
export type Thread = Row<ReturnType<typeof createThread>>;
export type Message = Row<ReturnType<typeof messagesForThread>>[number];
export type Conversation = {
  thread: Thread;
  messages: Message[];
  activeTurnId: string | null;
  pendingMessageId: string | null;
  interruptedTurnId: string | null;
};
export type Entry = Row<ReturnType<typeof getEntry>>;
export type EntryItem = Entry['items'][number];
export type Food = Row<ReturnType<typeof getFood>>;
export type FoodResult = FoodSearchResult;
export type Recipe = Row<ReturnType<typeof getRecipe>>;
export type RecipeResult = Row<ReturnType<typeof searchRecipes>>[number];
export type Day = Row<ReturnType<typeof dayTotals>>;
export type Settings = Row<ReturnType<typeof readSettings>> & {
  runtime: ReturnType<typeof providerConfig>;
};
export type Source = Json<typeof foodSources.$inferSelect>;
export type { HistoryMatch, ProviderStatus };

export type ApiProblem = { code: string; message: string; requestId?: string };
export type Pending = {
  type: 'pending';
  rawText: string;
  proposal: Proposal;
  clarification: PendingClarification | null;
  confirmed: number[];
  items?: ResolvedItem[];
};
export type ChatInput =
  | { kind: 'message'; text: string; messageId: string }
  | {
      kind: 'clarify';
      replyTo: string;
      selection: { grams: number } | { optionId: string } | { answers: ClarificationAnswer[] };
      replacements?: ReviewReplacement[];
      messageId: string;
    }
  | { kind: 'confirm'; replyTo: string; messageId: string; replacements?: ReviewReplacement[] };

type ChatPayloads = {
  message: { message: Message };
  text: { delta: string };
  tool: { name: string };
  proposal: { reply: string; title?: string; items: ResolvedItem[]; requiresConfirmation: boolean };
  clarification: { messageId: string; clarification: PendingClarification };
  draft: { messageId: string };
  committed: { entry: Entry };
  done: { threadId: string };
  error: { error: ApiProblem };
};

export type ChatEvent = {
  [Type in keyof ChatPayloads]: { type: Type; data: ChatPayloads[Type] };
}[keyof ChatPayloads];
