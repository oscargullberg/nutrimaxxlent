import { normalizeSearch } from '../importers/source.ts';
import {
  AgentError,
  type LlmProvider,
  type ProviderStatus,
  type ProviderStep,
  type ProviderStepRequest
} from './provider.ts';

type FixtureResolver = (
  input: string,
  step: number,
  request: ProviderStepRequest
) => ProviderStep | undefined;

export class FakeProvider implements LlmProvider {
  readonly name = 'fake';
  readonly model = 'fixture';

  private readonly resolveFixture: FixtureResolver;

  constructor(fixtures: Readonly<Record<string, readonly ProviderStep[]>> | FixtureResolver = {}) {
    this.resolveFixture =
      typeof fixtures === 'function'
        ? fixtures
        : (text, index) => (Object.hasOwn(fixtures, text) ? fixtures[text]?.[index] : undefined);
  }

  status(): Promise<ProviderStatus> {
    return Promise.resolve({ provider: this.name, model: this.model, connected: true as const });
  }

  step(request: ProviderStepRequest): Promise<ProviderStep> {
    if (request.signal.aborted) {
      return Promise.reject(
        new AgentError('AGENT_TIMEOUT', 'The resolution request was interrupted or timed out.')
      );
    }
    const lastUser = request.messages.findLastIndex((message) => message.role === 'user');
    const message = request.messages[lastUser];
    const text = typeof message?.content === 'string' ? normalizeSearch(message.content) : '';
    const stepIndex = request.messages
      .slice(lastUser + 1)
      .filter((part) => part.role === 'assistant').length;
    const next = this.resolveFixture(text, stepIndex, request);
    if (!next)
      return Promise.reject(
        new AgentError('INVALID_PROPOSAL', 'The fake provider has no fixture for this input.')
      );
    request.onText?.(next.text);
    return Promise.resolve(structuredClone(next));
  }
}
