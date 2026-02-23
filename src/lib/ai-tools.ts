import { tool } from "ai";
import { z } from "zod";
import prisma from "./prisma";

export const searchInRAG = tool({
  description:
    "Busca información relevante en la base de datos vectorial PostgreSQL (pgvector). " +
    "Usa esta herramienta SIEMPRE que el usuario pregunte sobre documentos subidos o requiera contexto. " +
    "CRÍTICO: La 'query' NUNCA debe estar vacía. Debe contener palabras clave, frases o el tema principal de lo que buscas.",
  parameters: z.object({
    query: z.string().describe("La consulta de búsqueda en lenguaje natural. NUNCA DEBE ESTAR VACÍA. Ejemplo: 'de qué trata el documento', 'resumen', 'conceptos clave'"),
  }),
  // @ts-ignore
  execute: async ({ query }) => {
    try {
      if (!query || query.trim().length === 0) {
        console.error("Error: Query vacía o undefined");
        return { results: [], error: "La consulta está vacía. Debes inferir un tema de la pregunta del usuario (por ejemplo: 'resumen del documento') y volver a intentar." };
      }

      console.log(` RAG Search: Generando embedding para "${query}"`);

      const response = await fetch("https://openrouter.ai/api/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "openai/text-embedding-3-s mall",
          input: query,
          dimensions: 768,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error("Error en API de embeddings:", errText);
        return { results: [], error: `Error al generar embedding: ${response.status}` };
      }

      const data = await response.json();

      if (!data.data || !data.data[0] || !data.data[0].embedding) {
        console.error("Respuesta inesperada de Embedding API:", data);
        return { results: [], error: "Respuesta inesperada del servicio de embeddings" };
      }

      const embedding = data.data[0].embedding;
      const embeddingString = `[${embedding.join(",")}]`;

      console.log(" Ejecutando búsqueda vectorial en PostgreSQL...");
      const documents: any[] = await prisma.$queryRawUnsafe(
        `
        SELECT 
          id, 
          content, 
          metadata, 
          1 - (embedding <=> $1::vector) as similarity
        FROM "Document" 
        WHERE embedding IS NOT NULL
        ORDER BY embedding <=> $1::vector ASC 
        LIMIT 5
        `,
        embeddingString
      );

      console.log(`Encontrados ${documents.length} resultados`);

      const results = documents.map((doc: any, index: number) => {
        const metadata = typeof doc.metadata === "string" ? JSON.parse(doc.metadata) : doc.metadata || {};
        const similarity = typeof doc.similarity === "object"
          ? parseFloat(doc.similarity.toString())
          : parseFloat(doc.similarity);

        return {
          rank: index + 1,
          source: metadata.fileName || "Documento sin nombre",
          content: doc.content,
          similarityScore: Math.round(similarity * 10000) / 100,
          chunkMetadata: {
            chunkIndex: metadata.chunkIndex ?? "N/A",
            totalChunks: metadata.totalChunks ?? "N/A",
            chunkLength: metadata.chunkLength || doc.content?.length || 0,
            uploadedAt: metadata.uploadedAt || "N/A",
          },
          documentId: doc.id,
        };
      });

      return {
        query,
        totalResults: results.length,
        results,
      };
    } catch (error: any) {
      console.error(" Fallo en RAG Search:", error);
      return {
        results: [],
        error: `Error en búsqueda RAG: ${error.message}`,
      };
    }
  },
});
