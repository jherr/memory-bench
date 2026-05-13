# Fairness wrinkle

memory-bench fans out the same `{user, assistant}` text pair to all three engines per turn. Each adapter then shapes that pair into its own native call:

- **Hindsight** — two `retain(bank_id, text)` calls, one for `user` and one for `assistant`.
- **mem0** — one `POST /memories` with the messages array `[{role:'user',content:user},{role:'assistant',content:assistant}]`.
- **Honcho** — one `session.addMessages([userPeer.message(user), assistantPeer.message(assistant)])`.

This is asymmetric. It is the *least unfair* option.

Forcing mem0 to take raw text would disable its messages-array extraction. Splitting a Honcho session into two single-message turns would defeat its conversation-aware deriver. Splitting Hindsight into a single messages-style call would deny it the per-utterance retain it was built for.

Each engine receives its preferred shape of the same content. The content is identical; the framing is each engine's own.

When reading the panels, the question is not "which engine got more correct" but "what did each engine extract from the same input, given its design."

The other shared decisions are:

- **Same LLM** for extraction across all three: `claude-haiku-4-5`. Env: `MODEL_EXTRACTION`.
- **Same chat model:** `claude-sonnet-4-5`. Env: `MODEL_CHAT`.
- **Same recall query**: the raw user message. No LLM rewriting in front of recall.
- **Same scope keys**: `userId` defaults to `demo-user`. `sessionId` maps to `bank_id` (Hindsight, composed with userId), `run_id` (mem0), and `session.id` (Honcho).

When you find divergence, that is the experiment. Don't hide it.
