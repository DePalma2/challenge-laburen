import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@/lib/prisma";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") {
    try {
      const chats = await prisma.chat.findMany({
        orderBy: { createdAt: "desc" },
      });
      return res.status(200).json(chats);
    } catch (e) {
      console.error(e);
      return res.status(500).json([]);
    }
  }

  if (req.method === "POST") {
    try {
      const { title } = req.body;
      const chat = await prisma.chat.create({
        data: {
          title: title || "Nuevo Chat",
        },
      });
      return res.status(200).json(chat);
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "Error al crear chat" });
    }
  }

  if (req.method === "DELETE") {
    try {
      const { id } = req.query;
      if (typeof id !== "string") return res.status(400).json({ error: "ID inválido" });

      await prisma.chat.delete({
        where: { id },
      });
      return res.status(200).json({ success: true });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "Error al eliminar chat" });
    }
  }

  return res.status(405).end();
}
