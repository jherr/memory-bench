# Fairness wrinkle

memory-bench fans out the same `{user, assistant}` text pair to all four engines per turn. Each adapter then shapes that pair into its own native call:

- **Hindsight** — two `retain(bank_id, text)` calls, one for `user` and one for `assistant`.
- **mem0** — one `POST /memories` with the messages array `[{role:'user',content:user},{role:'assistant',content:assistant}]`.
- **Honcho** — one `session.addMessages([userPeer.message(user), assistantPeer.message(assistant)])`.
- **TanMemory** — Haiku extracts atomic facts from the turn pair, then each fact runs through embed + KNN + Haiku-driven consolidation.

This is asymmetric. It is the *least unfair* option.

Forcing mem0 to take raw text would disable its messages-array extraction. Splitting a Honcho session into two single-message turns would defeat its conversation-aware deriver. Splitting Hindsight into a single messages-style call would deny it the per-utterance retain it was built for. TanMemory's extraction step is in-process by design — it's the reference implementation that interrogates "how much of this is just extraction?"

Recall has the same asymmetry. Hindsight, mem0, and TanMemory all produce ranked discrete fragments and pre-render them as a `- (source) text` list. Honcho's `peer.chat()` returns a synthesized dialectic paragraph with no discrete-item shape — forcing fragments onto it would be the same kind of violation as the retain wrinkles above. The `MemoryDriver.recall()` contract makes `fragments` optional for exactly this reason; Honcho omits it and puts the paragraph in `systemPrompt`.

Tools are exposed asymmetrically as well. Hindsight and TanMemory both ship three LLM-callable tools (`*_retain`/`_recall`/`_reflect`); mem0 and Honcho don't. Both have tool surfaces in their SDKs but neither documents tools as their canonical pattern, so we don't expose them. The driver interface makes empty `tools: []` and empty `toolGuidance: ''` the off-state for engines without tools — the chat route never branches on engine id.

Each engine receives its preferred shape of the same content. The content is identical; the framing is each engine's own.

When reading the panels, the question is not "which engine got more correct" but "what did each engine extract from the same input, given its design."

The other shared decisions are:

- **Same LLM** for extraction across all four: `claude-haiku-4-5`. Env: `MODEL_EXTRACTION`.
- **Same chat model:** `claude-sonnet-4-5`. Env: `MODEL_CHAT`.
- **Same recall query**: the raw user message. No LLM rewriting in front of recall.
- **Scope keys** (not identical across engines — that is intentional): `userId` defaults to `demo-user`. **Hindsight** uses a per-session bank id `userId__sessionId`. **mem0** scopes storage by `user_id` only (facts survive session rotation). **Honcho** uses the app workspace plus peer id and a `session` for chat/recall wiring; derived knowledge can persist beyond a single session. **TanMemory** stores in the per-session SQLite file (fully session-scoped, like Hindsight).

When you find divergence, that is the experiment. Don't hide it.
