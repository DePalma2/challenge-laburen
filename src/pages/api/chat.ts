import { streamText } from "ai";
import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@/lib/prisma";
import { chatModel, systemPrompt } from "@/lib/ai-config";
import { searchInRAG } from "@/lib/ai-tools";
import { Prisma } from "@prisma/client";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") {
    try {
      const messages = await prisma.message.findMany({
        where: { chatId: "chat-default" },
        orderBy: { createdAt: "asc" },
      });
      // Convert to ai SDK format
      const formatted = messages.map((m: any) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        // @ts-ignore
        toolInvocations: m.toolCalls ? m.toolCalls.map((tc: any) => ({
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
  const { messages } = req.body;
  const lastUserMessage = messages[messages.length - 1];

  try {
    await prisma.message.create({
      data: {
        chat: {
          connectOrCreate: {
            where: { id: "chat-default" },
            create: { id: "chat-default", title: "Chat RAG Principal" },
          },
        },
        role: "user",
        content: lastUserMessage.content,
      },
    });

    const result = await streamText({
      model: chatModel as any,
      system: systemPrompt,
      messages,
      tools: { searchInRAG },
      // @ts-ignore
      maxSteps: 5,
      onFinish: async (event) => {
        try {
          const reasoningValue = event.reasoning
            ? (typeof event.reasoning === "string"
              ? event.reasoning
              : Array.isArray(event.reasoning) && event.reasoning.length > 0
                ? JSON.stringify(event.reasoning)
                : null)
            : null;

          const combinedToolCalls = event.toolCalls?.map((tc: any) => {
            const tr = event.toolResults?.find((r: any) => r.toolCallId === tc.toolCallId);
            return {
              ...tc,
              result: tr ? (tr as any).result || (tr as any).output : null,
            };
          });

          await prisma.message.create({
            data: {
              chatId: "chat-default",
              role: "assistant",
              content: event.text || "",
              toolCalls: combinedToolCalls ? (combinedToolCalls as any) : Prisma.JsonNull,
              reasoning: reasoningValue,
            },
          });
          console.log("Respuesta persistida en Supabase.");
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
      switch (part.type) {
        case "text-delta":
          res.write(`0:${JSON.stringify((part as any).text || (part as any).textDelta)}\n`);
          break;
        case "tool-call":
          res.write(`9:${JSON.stringify({
            toolCallId: (part as any).toolCallId,
            toolName: (part as any).toolName,
            args: (part as any).args || (part as any).input || {},
          })}\n`);
          break;
        case "tool-result":
          res.write(`a:${JSON.stringify({
            toolCallId: (part as any).toolCallId,
            toolName: (part as any).toolName,
            args: (part as any).args || (part as any).input || {},
            result: (part as any).result || (part as any).output,
          })}\n`);
          break;
        case "error":
          res.write(`3:${JSON.stringify(String((part as any).error))}\n`);
          break;
        default:
          break;
      }
    }

    res.write(
      `d:${JSON.stringify({
        finishReason: "stop",
        usage: { promptTokens: 0, completionTokens: 0 },
      })}\n`
    );

    res.end();
  } catch (error) {
    console.error("Error Crítico API Chat:", error);
    if (!res.writableEnded) {
      res.status(500).json({ error: "Error interno del servidor" });
    }
  }
}