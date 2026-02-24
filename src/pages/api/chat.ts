import { streamText, stepCountIs } from "ai";
import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@/lib/prisma";
import { chatModel, systemPrompt } from "@/lib/ai-config";
import { makeSearchInRAG } from "@/lib/ai-tools";
import { Prisma } from "@prisma/client";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") {
    try {
      const { chatId } = req.query;
      const activeChatId = typeof chatId === "string" ? chatId : "chat-default";

      const messages = await prisma.message.findMany({
        where: { chatId: activeChatId },
        orderBy: { createdAt: "asc" },
      });

      // Convert to ai SDK format for the frontend
      const formatted = messages.map((m: any) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        toolInvocations: m.toolCalls ? (m.toolCalls as any[]).map((tc: any) => ({
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          args: tc.args || tc.input,
          result: tc.result || tc.output || null
        })) : undefined
      }));
      return res.status(200).json(formatted);
    } catch (e) {
      console.error(e);
      return res.status(500).json([]);
    }
  }

  if (req.method !== "POST") return res.status(405).end();
  const { messages, chatId } = req.body;
  const activeChatId = chatId || "chat-default";
  // Validate messages array
  if (!Array.isArray(messages) || messages.length === 0) {
    console.error('Invalid or missing messages payload');
    return res.status(400).json({ error: 'Invalid or missing messages' });
  }
  const lastUserMessage = messages[messages.length - 1];
  try {
    // Persist user message first if it doesn't exist (to avoid duplicates if client sent it twice)
    // Note: useChat might send the whole history, we only want to persist the NEW user message.
    if (lastUserMessage.role === "user" && lastUserMessage.id && !lastUserMessage.id.startsWith("temp-")) {
      const exists = await prisma.message.findFirst({
        where: { id: lastUserMessage.id }
      });

      if (!exists) {
        await prisma.message.create({
          data: {
            id: lastUserMessage.id,
            chat: {
              connectOrCreate: {
                where: { id: activeChatId },
                create: { id: activeChatId, title: "Chat RAG " + activeChatId.slice(0, 5) },
              },
            },
            role: "user",
            content: lastUserMessage.content,
          },
        });
      }
    } else if (lastUserMessage.role === "user") {
      // If it's a temporary ID, still persist it but maybe with a new UUID or just use connectOrCreate
      await prisma.message.create({
        data: {
          chat: {
            connectOrCreate: {
              where: { id: activeChatId },
              create: { id: activeChatId, title: "Chat RAG " + activeChatId.slice(0, 5) },
            },
          },
          role: "user",
          content: lastUserMessage.content,
        },
      });
    }


    const coreMessages = messages.map((m: any) => ({
      role: m.role as "user" | "assistant" | "system",
      content: typeof m.content === "string" ? m.content : String(m.content ?? ""),
    }));


    const result = await streamText({
      model: chatModel as any,
      system: systemPrompt,
      messages: coreMessages,
      tools: { searchInRAG: makeSearchInRAG(activeChatId) },
      stopWhen: stepCountIs(5),
      onFinish: async (event) => {
        try {
          const combinedToolCalls = event.toolCalls?.map((tc: any) => {
            const tr = event.toolResults?.find((r: any) => r.toolCallId === tc.toolCallId);
            return {
              ...tc,
              result: tr ? (tr as any).result || (tr as any).output : null,
            };
          });

          await prisma.message.create({
            data: {
              chatId: activeChatId,
              role: "assistant",
              content: event.text || "",
              toolCalls: combinedToolCalls ? (combinedToolCalls as any) : Prisma.JsonNull,
            },
          });
        } catch (dbError) {
          console.error("Error al persistir respuesta:", dbError);
        }
      },
    });

    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Vercel-AI-Data-Stream": "v1",
      "Transfer-Encoding": "chunked",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });

    for await (const part of result.fullStream) {
      const p = part as any;
      switch (p.type) {
        case "text-delta":
          res.write(`0:${JSON.stringify(p.text || p.textDelta)}\n`);
          break;
        case "tool-call":
          res.write(`9:${JSON.stringify({
            toolCallId: p.toolCallId,
            toolName: p.toolName,
            args: p.args || p.input,
          })}\n`);
          break;
        case "tool-result":
          res.write(`a:${JSON.stringify({
            toolCallId: p.toolCallId,
            toolName: p.toolName,
            args: p.args || p.input,
            result: p.result || p.output,
          })}\n`);
          break;
        case "error":
          res.write(`3:${JSON.stringify(String(p.error))}\n`);
          break;
        default:
          break;
      }
    }


    res.write(`d:${JSON.stringify({ finishReason: "stop", usage: { promptTokens: 0, completionTokens: 0 } })}\n`);
    res.end();
  } catch (error) {
    console.error("Error Crítico API Chat:", error);
    if (!res.writableEnded) {
      res.status(500).json({ error: "Error interno del servidor" });
    }
  }
}
