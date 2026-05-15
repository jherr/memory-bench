# scope.md

What this framework addresses, and what it deliberately leaves to the agent
or to other systems.

The word "memory" in the LLM agent world covers more ground than any one
framework can or should. This document maps the territory and locates
`@tanstack/ai-memory` within it.

## Memory types

Cognitive science distinguishes several memory systems. Mapping them onto
LLM agents is metaphor, not science — humans and language models work in
fundamentally different ways — but the taxonomy is useful because it forces
honesty about what a "memory" system is and is not doing.

### Working memory

The information actively held during reasoning. In humans, this is the
few-second window of conscious attention. In an LLM agent, working memory is
the **context window** — the tokens the model is currently attending to.
Working memory is not a database. It is not retrieved; it is *present*.

Working memory has its own engineering problems: context-window management,
scratchpad strategies, summarization to free space, attention dynamics over
long contexts. These problems are real but they are not "memory" in the
sense this framework addresses. They are concerns of the agent loop, not of
an external memory layer.

### Episodic memory

Specific events, anchored in time. "On Tuesday the user mentioned they're
allergic to penicillin." Episodes are particular and timestamped. They are
typically what people mean when they say an LLM agent should "remember the
conversation."

### Semantic memory

Generalized knowledge abstracted from episodes. "The user is allergic to
penicillin" — no longer tied to when it was said, just known. Semantic
memory is what episodic memory becomes after consolidation: facts the agent
can use without needing to recall the specific moment they were learned.

### Procedural memory

Learned skills, often non-declarative. Riding a bicycle. Touch-typing. In
LLM agents, procedural knowledge is either baked into model weights
(fine-tuning) or simulated by re-providing instructions and examples on
each turn. There is no equivalent in current LLM architectures to "the
agent learned to do X better by doing X many times" without explicit
fine-tuning or evaluation infrastructure outside the chat loop.

## What this framework addresses

`@tanstack/ai-memory` is a framework for **episodic and semantic memory,
with consolidation between them.**

- **Retain** (via `retainTurn`) captures episodic content (the user message
  and the assistant reply).
- **Consolidation** — performed by the `Consolidator` stage in composed
  drivers, or by service-internal pipelines in vendor drivers — abstracts
  episodic content into semantic facts that can be retrieved without their
  original conversational context.
- **Recall** retrieves both episodic fragments and semantic facts to inform
  the next turn.
- **Inspect** and **`listFacts`** expose the current state of stored memory
  for observability and UI panels.

This is the layer of "memory" current LLM agents can meaningfully use: an
external store that survives across context-window resets and across
sessions, populated through turn-by-turn interaction, and queried before
generation to provide relevant context.

## What this framework does not address

**Working memory** is the agent's context-window problem. Strategies like
sliding-window history, summarization of older turns, or selective
re-injection of recent content are concerns of the agent loop.
`@tanstack/ai-memory` provides the `systemPrompt` block to be injected;
how the chat application assembles its overall context is outside scope.

**Procedural memory** as skill acquisition is not addressed at all. An
agent that uses this framework's memory does not learn to act better over
time in any way distinct from "having more facts available to retrieve."
If you need an agent that genuinely improves at a task with repeated
exposure, you need evaluation, training data, and fine-tuning — none of
which this framework offers or tries to.

**Long-term context compression** for ultra-long sessions (millions of
tokens of conversation) is adjacent but not the same thing. A driver could
be built that performs this kind of compression, but the framework is not
optimized for it. Specialized systems exist for this class of problem.

**Memory across multiple agents** sharing state is a coordination problem.
The framework supports it trivially (multiple agents share a `Scope`, all
writes are visible to all readers) but provides no specific tooling for
coordination, conflict resolution, or multi-agent consistency.

## Tools as a driver concern

The framework's `RecallResult` allows drivers to expose tools to the LLM
during a turn (`tools: Array<Tool>` plus `toolGuidance: string`). This is
a protocol feature, not a framework opinion.

Whether memory operations should be tools the LLM controls, or middleware
the system controls, is a contested design question with reasonable
answers on both sides. The framework takes no position. The protocol
supports both. Specific drivers may choose:

- **Middleware only** — `recall` returns content and an empty `tools`
  array. The LLM has no direct control. This is the canonical pattern for
  the mem0 and Honcho providers and the default for composed drivers.
- **Tools only** — `recall` returns an empty `systemPrompt` and a populated
  `tools` array. The LLM decides when to query memory.
- **Both** — `recall` returns both. The LLM gets automatic recall and can
  also explicitly invoke tools for retain, recall, or synthesis operations
  the middleware doesn't cover. This is Hindsight's documented "full
  setup" pattern.

The framework's only requirement is that drivers be explicit about what
they expose. Empty array and empty string are valid; absent fields are not.

When a driver does expose tools, `scope.toolEvents` (see
[`protocol.md`](./protocol.md)) lets it report tool-driven retain/recall
events back to the orchestrator so they can be logged alongside
middleware-driven ones.

## Why this scope

A framework that tried to address all forms of memory would either be
enormous and prescriptive, or anodyne and useless. By limiting scope to
episodic and semantic memory with explicit hooks for consolidation, the
framework can be small, the protocol can be precise, and users can compose
it with whatever solutions they prefer for the concerns it doesn't address.

This is also the honest scope of what current LLM agent memory systems
actually deliver. Reading the public documentation of hosted memory
services, what they all share — across different architectures, ontologies,
and retrieval strategies — is exactly this layer: retain content over time,
surface relevant pieces of it back. Calling that "memory" is a stretch,
given everything the word means, but it is the part of memory that the
current generation of agents can meaningfully use.

## Field context

For readers placing this framework against the landscape:

| System                  | Episodic       | Semantic                  | Consolidation        | Tools-first      | Self-host  |
|-------------------------|----------------|---------------------------|----------------------|------------------|------------|
| Hindsight               | yes            | yes                       | yes (observations)   | hybrid (both)    | yes        |
| mem0                    | partially      | yes                       | yes (synchronous)    | no               | yes        |
| Honcho                  | yes            | yes (representations)     | yes (async)          | no               | yes        |
| Letta                   | yes            | yes (archival vs core)    | manual via agent     | n/a (different)  | yes        |
| Zep                     | yes            | yes (graph)               | yes                  | optional         | deprecated |
| `@tanstack/ai-memory`   | protocol-level | protocol-level            | composition stage    | per driver       | universal  |

The framework's purpose is not to compete with these systems. It is to
provide a common protocol so that multiple systems can be compared,
swapped, or composed without rewriting the agent loop around each.
