import type { NextApiRequest, NextApiResponse } from "next";
import fs from "fs";
import path from "path";
import { prisma } from "@/lib/prisma";

export const config = {
  api: { bodyParser: false },
};

async function parseForm(req: NextApiRequest): Promise<{ fields: any; files: any }> {
  const formidable = (await import("formidable")).default;
  const form = formidable({
    maxFileSize: 20 * 1024 * 1024,
    keepExtensions: true,
  });

  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

async function extractText(filePath: string, fileName: string): Promise<string> {
  const ext = path.extname(fileName).toLowerCase();

  switch (ext) {
    case ".pdf": {
      const dataBuffer = fs.readFileSync(filePath);
      const pdfParseModule = require("pdf-parse");
      const PDFParse = pdfParseModule.PDFParse || pdfParseModule.default?.PDFParse || pdfParseModule;

      if (typeof PDFParse === "function" && PDFParse.prototype?.getText) {
        const parser = new PDFParse({ data: new Uint8Array(dataBuffer) });
        const textResult = await parser.getText();
        await parser.destroy();
        return textResult.text;
      } else if (typeof PDFParse === "function") {
        const pdfData = await PDFParse(dataBuffer);
        return pdfData.text;
      } else {
        throw new Error("No se pudo cargar pdf-parse correctamente. Tipo: " + typeof PDFParse);
      }
    }
    case ".txt":
    case ".md": {
      return fs.readFileSync(filePath, "utf-8");
    }
    case ".docx": {
      const AdmZip = require("adm-zip");
      const zip = new AdmZip(filePath);
      const contentXml = zip.readAsText("word/document.xml");
      const textMatches = contentXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [];
      return textMatches
        .map((match: string) => match.replace(/<[^>]+>/g, ""))
        .join(" ");
    }
    default:
      throw new Error(`Formato no soportado: ${ext}. Usa PDF, TXT, MD o DOCX.`);
  }
}

async function generateEmbedding(text: string): Promise<number[]> {
  const response = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/text-embedding-3-small",
      input: text,
      dimensions: 768,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`OpenRouter Embedding API error (${response.status}): ${errorBody}`);
  }

  const data = await response.json();
  if (!data.data || !data.data[0] || !data.data[0].embedding) {
    throw new Error(`Respuesta inesperada de Embedding API: ${JSON.stringify(data)}`);
  }

  return data.data[0].embedding;
}

function smartChunk(text: string, maxLen = 800): string[] {
  const paragraphs = text.split(/\n\s*\n/);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    if ((current + "\n\n" + trimmed).length > maxLen && current) {
      chunks.push(current.trim());
      current = trimmed;
    } else {
      current = current ? current + "\n\n" + trimmed : trimmed;
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  const finalChunks: string[] = [];
  for (const chunk of chunks) {
    if (chunk.length <= maxLen) {
      finalChunks.push(chunk);
    } else {
      const sentences = chunk.match(/[^.!?]+[.!?]+/g) || [chunk];
      let sub = "";
      for (const sent of sentences) {
        if ((sub + sent).length > maxLen && sub) {
          finalChunks.push(sub.trim());
          sub = sent;
        } else {
          sub += sent;
        }
      }
      if (sub.trim()) finalChunks.push(sub.trim());
    }
  }

  return finalChunks.filter((c) => c.length > 10);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    console.log("📥 Recibiendo archivo...");
    const { files } = await parseForm(req);

    const file = Array.isArray(files.file) ? files.file[0] : files.file;
    if (!file) {
      return res.status(400).json({ error: "No se encontró el archivo en la request" });
    }

    const fileName = file.originalFilename || "documento_sin_nombre";
    console.log(` Archivo recibido: ${fileName} (${(file.size / 1024).toFixed(1)} KB)`);

    const fullText = await extractText(file.filepath, fileName);

    if (!fullText || fullText.trim().length < 10) {
      return res.status(400).json({ error: "No se pudo extraer texto del archivo. Verifica que no esté vacío o sea un PDF de imágenes." });
    }

    console.log(` Texto extraído: ${fullText.length} caracteres`);

    const chunks = smartChunk(fullText);
    console.log(` Fragmentando en ${chunks.length} chunks...`);

    let processed = 0;
    const errors: string[] = [];

    for (const chunk of chunks) {
      try {
        const embedding = await generateEmbedding(chunk);

        await prisma.$executeRawUnsafe(
          `INSERT INTO "Document" (id, content, embedding, metadata) 
           VALUES (gen_random_uuid(), $1, $2::vector, $3::jsonb)`,
          chunk,
          `[${embedding.join(",")}]`,
          JSON.stringify({
            fileName,
            chunkIndex: processed,
            totalChunks: chunks.length,
            chunkLength: chunk.length,
            uploadedAt: new Date().toISOString(),
          })
        );

        processed++;
        console.log(`  Chunk ${processed}/${chunks.length} indexado`);
      } catch (chunkError: any) {
        console.error(`   Error en chunk ${processed + 1}:`, chunkError.message);
        errors.push(`Chunk ${processed + 1}: ${chunkError.message}`);
      }
    }

    try {
      fs.unlinkSync(file.filepath);
    } catch (_) { }

    if (processed === 0) {
      return res.status(500).json({
        error: "No se pudo indexar ningún fragmento",
        details: errors,
      });
    }

    return res.status(200).json({
      message: "Documento indexado con éxito",
      fileName,
      chunks: processed,
      totalChunks: chunks.length,
      errors: errors.length > 0 ? errors : undefined,
      textLength: fullText.length,
    });
  } catch (error: any) {
    console.error(" Error en Upload/Ingesta:", error);
    return res.status(500).json({
      error: "Error al procesar el documento",
      details: error.message,
    });
  }
}