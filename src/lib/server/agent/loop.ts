import { asSchema, type AssistantContent, type ModelMessage, type ToolSet } from 'ai';
import { AgentError, type LlmProvider, type ProviderStep } from './provider.ts';
import { agentProposalSchema } from './proposal.ts';

export type LoopTrace = { toolCalls: string[]; inputTokens: number; outputTokens: number };
type OversizedToolBatch = { count: number; step: number; toolCounts: Record<string, number> };

const maxToolsPerStep = 12;

export async function runToolLoop(
  provider: LlmProvider,
  options: {
    system: string;
    messages: ModelMessage[];
    tools: ToolSet;
    signal?: AbortSignal;
    maxSteps?: number;
    timeoutMs?: number;
    onText?: (text: string) => void;
    onTool?: (name: string) => void;
    onOversizedBatch?: (batch: OversizedToolBatch) => void;
    trace?: LoopTrace;
  }
) {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 60_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let abortListener: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    abortListener = () =>
      reject(new AgentError('AGENT_TIMEOUT', 'Resolution was interrupted or timed out.'));
    if (signal.aborted) abortListener();
    else signal.addEventListener('abort', abortListener, { once: true });
  });
  const messages = [...options.messages];
  // Tool execution is controlled by this loop. Models only receive the schemas.
  const definitions = Object.fromEntries(
    Object.entries(options.tools).map(([name, entry]) => [
      name,
      { description: entry.description, inputSchema: entry.inputSchema, strict: false }
    ])
  );
  const trace = options.trace ?? { toolCalls: [], inputTokens: 0, outputTokens: 0 };
  const maxSteps = options.maxSteps ?? 6;
  let system = `${options.system}
Use at most ${maxToolsPerStep} lookup calls per step. Submit the final proposal in a step by itself.`;
  let retriedBatch = false;
  let finalOnly = false;

  try {
    for (let step = 0; step < maxSteps; step++) {
      const result: ProviderStep = await Promise.race([
        aborted,
        provider.step({
          system,
          messages,
          tools: finalOnly ? { submit_proposal: definitions.submit_proposal! } : definitions,
          toolChoice: finalOnly ? 'required' : undefined,
          signal,
          onText: (text) => {
            if (!signal.aborted) options.onText?.(text);
          }
        })
      ]);
      trace.inputTokens += result.tokens?.input ?? 0;
      trace.outputTokens += result.tokens?.output ?? 0;
      if (result.toolCalls.length > maxToolsPerStep) {
        if (options.onOversizedBatch) {
          const toolCounts = new Map<string, number>();
          for (const { name } of result.toolCalls) {
            if (Object.hasOwn(definitions, name))
              toolCounts.set(name, (toolCounts.get(name) ?? 0) + 1);
          }
          options.onOversizedBatch({
            count: result.toolCalls.length,
            step: step + 1,
            toolCounts: Object.fromEntries(toolCounts)
          });
        }
        if (retriedBatch || step + 1 === maxSteps) {
          throw new AgentError(
            'AGENT_TOOL_LIMIT',
            'I couldn’t finish looking up this meal. Try again or log the foods separately.'
          );
        }
        retriedBatch = true;
        system += `\nAn earlier response requested ${result.toolCalls.length} tool calls in one step and was skipped. Continue from the existing context. Use lookups only for details needed to resolve the request.`;
        continue;
      }
      const terminal = result.toolCalls.filter(({ name }) => name === 'submit_proposal');
      if (terminal.length === 1 && result.toolCalls.length === 1) {
        const parsed = agentProposalSchema.safeParse(terminal[0]?.input);
        trace.toolCalls.push('submit_proposal');
        options.onTool?.('submit_proposal');
        if (!parsed.success) {
          throw new AgentError('INVALID_PROPOSAL', 'The terminal proposal is invalid.');
        }
        return { proposal: parsed.data, trace };
      }

      if (finalOnly) throw new AgentError('INVALID_PROPOSAL', 'The terminal proposal is invalid.');
      const lookups = result.toolCalls.filter(({ name }) => name !== 'submit_proposal');
      if (terminal.length) {
        if (!definitions.submit_proposal || step + 1 === maxSteps)
          throw new AgentError('INVALID_PROPOSAL', 'The terminal proposal is invalid.');
        finalOnly = true;
        system += '\nFinish with exactly one submit_proposal call using the available results.';
        if (!lookups.length) continue;
      }
      const assistant: AssistantContent = result.text ? [{ type: 'text', text: result.text }] : [];
      for (const call of lookups) {
        assistant.push({
          type: 'tool-call',
          toolCallId: call.id,
          toolName: call.name,
          input: call.input
        });
      }
      messages.push({ role: 'assistant', content: assistant });
      if (lookups.length) {
        const outputs = await Promise.race([
          aborted,
          Promise.all(
            lookups.map(async (call) => {
              const tool = Object.hasOwn(options.tools, call.name)
                ? options.tools[call.name]
                : undefined;
              if (!tool?.execute)
                throw new AgentError(
                  'INVALID_PROPOSAL',
                  'The model requested an unavailable tool.'
                );
              trace.toolCalls.push(call.name);
              options.onTool?.(call.name);
              const validation = await asSchema(tool.inputSchema).validate?.(call.input);
              if (validation && !validation.success) {
                throw new AgentError('INVALID_PROPOSAL', 'The model supplied invalid tool input.');
              }
              const output = await tool.execute((validation?.value ?? call.input) as never, {
                toolCallId: call.id,
                messages,
                abortSignal: signal
              });
              return {
                type: 'tool-result' as const,
                toolCallId: call.id,
                toolName: call.name,
                output: { type: 'text' as const, value: JSON.stringify(output ?? null) }
              };
            })
          )
        ]);
        messages.push({ role: 'tool', content: outputs });
      }
    }
    throw new AgentError(
      'AGENT_STEP_LIMIT',
      'The resolution did not produce a proposal within the step limit.'
    );
  } finally {
    if (abortListener) signal.removeEventListener('abort', abortListener);
  }
}
