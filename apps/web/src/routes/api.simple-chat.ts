import { createFileRoute } from "@tanstack/react-router";
import { chat, toServerSentEventsResponse } from "@tanstack/ai";
import { anthropicText } from "@tanstack/ai-anthropic";
import { createMemoryMiddleware } from "@tanstack/ai-memory/middleware";

import { chatRequestSchema } from "#/lib/chat-request-schema";
import { getEngine } from "#/server/memory/orchestrator";
import { isValidEngineId, isValidSessionId } from "#/server/validation/ids";

import type { EngineId } from "@tanstack/ai-memory";

const MODEL_CHAT = (process.env.MODEL_CHAT ??
  "claude-sonnet-4-5") as Parameters<typeof anthropicText>[0];

const BASE_SYSTEM_PROMPT = `You are a helpful assistant with access to persistent memory.

You may have memory recalled for this turn. Use it freely if it is relevant; do not mention the recall step itself. If the recalled memory is empty, answer normally without commenting on its absence.

Keep replies concise unless the user asks for depth.`;

export const Route = createFileRoute("/api/simple-chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const requestSignal = request.signal;
        if (requestSignal.aborted) {
          return new Response(null, { status: 499 });
        }
        const abortController = new AbortController();

        try {
          const parsed = chatRequestSchema.safeParse(await request.json());
          if (!parsed.success) {
            return new Response(
              JSON.stringify({ error: "invalid chat payload" }),
              {
                status: 400,
                headers: { "Content-Type": "application/json" },
              },
            );
          }
          const body = parsed.data;
          const messages = body.messages;
          const sessionId = body.data?.sessionId ?? body.sessionId ?? "";
          if (!sessionId || !isValidSessionId(sessionId)) {
            return new Response(
              JSON.stringify({ error: "invalid session id" }),
              {
                status: 400,
                headers: { "Content-Type": "application/json" },
              },
            );
          }

          const requestedEngineId = body.data?.engineId ?? body.engineId;
          if (requestedEngineId && !isValidEngineId(requestedEngineId)) {
            return new Response(
              JSON.stringify({ error: "invalid engine id" }),
              {
                status: 400,
                headers: { "Content-Type": "application/json" },
              },
            );
          }
          const engineId = (requestedEngineId ?? "hindsight") as EngineId;

          const memoryEnabled =
            body.data?.memoryEnabled ?? body.memoryEnabled ?? true;

          const adapter = anthropicText(MODEL_CHAT);
          const middleware = memoryEnabled
            ? [
                createMemoryMiddleware({
                  engine: getEngine(engineId),
                  scope: { sessionId },
                  role: "recall+retain",
                }),
              ]
            : [];

          const stream = chat({
            adapter,
            systemPrompts: [BASE_SYSTEM_PROMPT],
            messages: messages as any,
            abortController,
            middleware,
          });

          return toServerSentEventsResponse(stream, { abortController });
        } catch (error: any) {
          if (error.name === "AbortError" || abortController.signal.aborted) {
            return new Response(null, { status: 499 });
          }
          console.error("[api/simple-chat] error:", error);
          return new Response(
            JSON.stringify({ error: "Failed to process chat request" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
