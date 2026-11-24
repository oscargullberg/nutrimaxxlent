import type { ModelMessage, ToolSet } from 'ai';
import type { ProductEvidence } from './product-evidence.ts';

export type ProviderName = 'codex' | 'fake';

export type AgentErrorCode =
  | 'PROVIDER_NOT_CONNECTED'
  | 'PROVIDER_MODEL_UNAVAILABLE'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'AGENT_TIMEOUT'
  | 'AGENT_STEP_LIMIT'
  | 'AGENT_TOOL_LIMIT'
  | 'INVALID_PROPOSAL'
  | 'CATALOG_EMPTY'
  | 'AMBIGUOUS_MATCH'
  | 'UNIT_UNRESOLVED';

export class AgentError extends Error {
  constructor(
    public readonly code: AgentErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'AgentError';
  }
}

export type ProviderStatus = {
  provider: ProviderName;
  model: string;
} & ({ connected: true } | { connected: false; code: AgentErrorCode; message: string });

export type ProviderStepRequest = {
  system: string;
  messages: ModelMessage[];
  tools: ToolSet;
  toolChoice?: 'required';
  signal: AbortSignal;
  onText?: (text: string) => void;
};

export type ProviderStep = {
  text: string;
  toolCalls: { id: string; name: string; input: unknown }[];
  tokens?: { input?: number; output?: number };
};

export type PortionLookupRequest = {
  name: string;
  nameEn: string | null;
  brand: string | null;
  barcode: string | null;
  unit: string;
  volumeMl: number | null;
};

export type PortionLookupResult = {
  weight: { grams: number; sourceUrl: string | null; singlePieceServing: boolean } | null;
  tokens?: ProviderStep['tokens'];
};

export interface LlmProvider {
  name: ProviderName;
  model: string;
  status(): Promise<ProviderStatus>;
  step(request: ProviderStepRequest): Promise<ProviderStep>;
  lookupPortion?(food: PortionLookupRequest, signal: AbortSignal): Promise<PortionLookupResult>;
  lookupProduct?(
    query: string,
    signal: AbortSignal
  ): Promise<
    ProductEvidence & {
      tokens?: ProviderStep['tokens'];
      reason?: 'web_search_not_run' | 'web_search_failed' | 'source_unverified';
    }
  >;
}
