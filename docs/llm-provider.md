# LLM provider

The default `codex` provider uses the Codex CLI's current ChatGPT session. It is intended for this personal localhost application. The provider uses an unofficial [Codex OAuth adapter](https://github.com/RespectMathias/openai-codex-oauth). Access depends on the models available to the signed-in account.

Sign in when the app reports `PROVIDER_NOT_CONNECTED`.

```sh
npx @openai/codex login
npx @openai/codex login status
pnpm provider:smoke
```

The smoke test sends one synthetic catalog item, validates a tool proposal, and computes its nutrients. It does not read the app database or send meal history.

Set `LLM_PROVIDER=codex` in `.env`. The default model is `gpt-6.2-sol`. Set `LLM_MODEL` to use a different model enabled for the account. The service reads `$CODEX_HOME/auth.json` or `~/.codex/auth.json` if `CODEX_HOME` is unset. The app reads the active access token and lets the Codex CLI manage credential writes and refresh. If the session expires, run the sign-in command again. Use Codex's file credential store for this integration.

The provider connection status indicates whether a usable local credential is present. The smoke command also confirms that the endpoint accepts the configured model. A normal chat turn sends the message and bounded candidate and history context to Codex for interpretation. The app computes catalog nutrients locally and stores only the provider name, model name, tool names, timing, token counts, and status in the run trace.

If the model requests more than 12 tools in a step, the app skips the batch and retries once
within the turn's existing step and time limits. The server warning includes the run ID, step,
total call count, and counts by recognized tool name. If no step remains or another batch exceeds
the limit, the run records `AGENT_TOOL_LIMIT`.

If a step mixes catalog lookups and a final proposal, the app runs the lookups and requests a
fresh proposal using only the submission tool in the next step. Both paths share the turn's step
and time budget. The food search tool can resolve several distinct queries in one call.

When a public catalog match has no conversion for the requested unit, the app sends Codex the
unit and catalog identity, including the brand and barcode when available. Codex can use web
search or provide a typical estimate for routine quantities. The app saves grams per unit and any
source URL under **Foods → Portions**. Later entries reuse that conversion, and a personal weight
for the same unit takes precedence. Chat asks for grams when it cannot resolve a usable amount.

For each named product in the interpreted meal, the server checks for a local exact match first.
If it finds none, it requires a Codex web search before asking for clarification or offering a
generic substitute. It saves documented nutrients, any documented piece weight and the label
link. It also accepts labels declared by volume and identifies any estimated density used to
convert volume to weight. Later turns can use the saved product through local search.

Set `LLM_PROVIDER=fake` for deterministic test fixtures. This mode needs no Codex sign-in.
