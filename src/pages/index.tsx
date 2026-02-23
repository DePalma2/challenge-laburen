import { useChat } from "@ai-sdk/react";
import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";

interface RAGResult {
  rank: number;
  source: string;
  content: string;
  similarityScore: number;
  chunkMetadata: {
    chunkIndex: number | string;
    totalChunks: number | string;
    chunkLength: number;
    uploadedAt: string;
  };
  documentId: string;
}

interface RAGResponse {
  query: string;
  totalResults: number;
  results: RAGResult[];
}

function ToolStateIndicator({ toolName, state }: { toolName: string; state: string }) {
  const isRunning = state === "running" || !(state === "completed" || state === "done");
  const labels: Record<string, string> = {
    searchInRAG: "Buscando en documentos",
    uploadToRAG: "Subiendo archivo al RAG",
  };

  return (
    <div className={`tool-state ${isRunning ? "tool-running" : "tool-done"}`}>
      <div className="tool-state-icon">
        {isRunning ? (
          <svg className="spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" strokeDasharray="31.42" strokeDashoffset="10" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
      <span className="tool-state-label">
        {isRunning ? labels[toolName] || `Ejecutando ${toolName}` : `✓ ${toolName} completado`}
      </span>
    </div>
  );
}

function RAGResults({ data }: { data: RAGResponse }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  if (!data || !data.results || data.results.length === 0) {
    return (
      <div className="rag-empty">
        No se encontraron documentos relevantes para: &quot;{data?.query}&quot;
      </div>
    );
  }

  return (
    <div className="rag-results">
      <div className="rag-header">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <span>RAG Search: {data.totalResults} fuentes encontradas para &quot;{data.query}&quot;</span>
      </div>
      <div className="rag-sources">
        {data.results.map((result, i) => (
          <div
            key={result.documentId || i}
            className={`rag-source ${expandedIdx === i ? "expanded" : ""}`}
          >
            <button
              className="rag-source-header"
              onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
            >
              <div className="rag-source-rank">#{result.rank}</div>
              <div className="rag-source-info">
                <div className="rag-source-name">📄 {result.source}</div>
                <div className="rag-source-meta">
                  <span className="rag-similarity" data-score={
                    result.similarityScore >= 80 ? "high" : result.similarityScore >= 50 ? "mid" : "low"
                  }>
                    {result.similarityScore}% similitud
                  </span>
                  <span className="rag-chunk-info">
                    Chunk {result.chunkMetadata.chunkIndex}/{result.chunkMetadata.totalChunks}
                  </span>
                  <span className="rag-chunk-length">
                    {result.chunkMetadata.chunkLength} chars
                  </span>
                </div>
              </div>
              <div className={`rag-expand-icon ${expandedIdx === i ? "open" : ""}`}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </div>
            </button>
            {expandedIdx === i && (
              <div className="rag-source-content">
                <div className="rag-fragment-label">Fragmento recuperado:</div>
                <blockquote className="rag-fragment">{result.content}</blockquote>
                <div className="rag-metadata-footer">
                  <span> Subido: {
                    result.chunkMetadata.uploadedAt !== "N/A"
                      ? new Date(result.chunkMetadata.uploadedAt).toLocaleString("es-AR")
                      : "N/A"
                  }</span>
                  <span>🔑 ID: {result.documentId?.slice(0, 8)}</span>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function UploadProgress({ stage, fileName, progress }: {
  stage: string;
  fileName: string;
  progress: number;
}) {
  const stages = [
    { id: "reading", label: "Leyendo archivo", icon: "📥" },
    { id: "extracting", label: "Extrayendo texto", icon: "📝" },
    { id: "chunking", label: "Fragmentando", icon: "🧩" },
    { id: "embedding", label: "Generando embeddings", icon: "🧮" },
    { id: "storing", label: "Almacenando en pgvector", icon: "💾" },
    { id: "done", label: "Completado", icon: "✅" },
  ];

  const currentIdx = stages.findIndex((s) => s.id === stage);

  return (
    <div className="upload-progress">
      <div className="upload-progress-header">
        <span className="upload-filename">📄 {fileName}</span>
      </div>
      <div className="upload-stages">
        {stages.map((s, i) => (
          <div
            key={s.id}
            className={`upload-stage ${
              i < currentIdx ? "completed" : i === currentIdx ? "active" : "pending"
            }`}
          >
            <span className="stage-icon">{s.icon}</span>
            <span className="stage-label">{s.label}</span>
            {i === currentIdx && i < stages.length - 1 && (
              <div className="stage-spinner" />
            )}
          </div>
        ))}
      </div>
      <div className="upload-bar-container">
        <div className="upload-bar" style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}

export default function ChatPage() {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStage, setUploadStage] = useState("reading");
  const [uploadFileName, setUploadFileName] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadResult, setUploadResult] = useState<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // @ts-ignore
  const { messages, input, handleInputChange, handleSubmit, isLoading, setMessages } = useChat({
    // @ts-ignore
    api: "/api/chat",
  });

  useEffect(() => {
    fetch("/api/chat")
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          setMessages(data);
        }
      })
      .catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedExts = [".pdf", ".txt", ".md", ".docx"];
    const ext = "." + file.name.split(".").pop()?.toLowerCase();
    if (!allowedExts.includes(ext)) {
      alert(`Formato no soportado: ${ext}\nFormatos permitidos: PDF, TXT, MD, DOCX`);
      return;
    }

    setIsUploading(true);
    setUploadFileName(file.name);
    setUploadStage("reading");
    setUploadProgress(10);
    setUploadResult(null);

    const formData = new FormData();
    formData.append("file", file);

    const progressStages = [
      { stage: "extracting", progress: 25, delay: 500 },
      { stage: "chunking", progress: 40, delay: 1000 },
      { stage: "embedding", progress: 60, delay: 1500 },
      { stage: "storing", progress: 80, delay: 2500 },
    ];

    const timers: NodeJS.Timeout[] = [];
    for (const ps of progressStages) {
      timers.push(
        setTimeout(() => {
          setUploadStage(ps.stage);
          setUploadProgress(ps.progress);
        }, ps.delay)
      );
    }

    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      timers.forEach(clearTimeout);
      const data = await res.json();

      if (res.ok) {
        setUploadStage("done");
        setUploadProgress(100);
        setUploadResult(data);
      } else {
        throw new Error(data.error || data.details || "Error desconocido");
      }
    } catch (err: any) {
      timers.forEach(clearTimeout);
      setUploadStage("reading");
      setUploadProgress(0);
      setUploadResult({ error: err.message });
    } finally {
      setTimeout(() => {
        setIsUploading(false);
        setUploadStage("reading");
        setUploadProgress(0);
      }, 4000);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, []);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    handleSubmit(e);
  };

  return (
    <div className="chat-container">
      <div className="chat-header">
        <span className="header-title">Challenge</span>
      </div>

      <div className="messages-area">
        {messages.length === 0 && (
          <div className="empty-state">
            <div className="empty-icon">💬</div>
            <div className="empty-title">Hola!</div>
            <div className="empty-subtitle">
              Subí un documento PDF, TXT, MD o DOCX con el botón 📄 y luego preguntame sobre su contenido.
              Uso RAG con pgvector para buscar información relevante.
            </div>
          </div>
        )}

        {messages.map((m: any) => (
          <div key={m.id} className={`msg msg-${m.role}`}>
            <div className="msg-role">
              {m.role === "user" ? "Tú" : "Asistente AI"}
            </div>
            <div className="msg-bubble">
              {m.role === "assistant" ? (
                (m.content.trim().startsWith('{"name"') || m.content.trim().startsWith('{"tool')) ? null : (
                  m.content.trim() ? <ReactMarkdown>{m.content}</ReactMarkdown> : null
                )
              ) : (
                <p>{m.content}</p>
              )}

              {m.toolInvocations && m.toolInvocations.length > 0 && (
                <details className="rag-details-container">
                  <summary className="rag-details-summary">
                    🔍 Ver detalles de la búsqueda (RAG)
                  </summary>
                  <div className="rag-details-content">
                    {m.toolInvocations.map((tool: any) => {
                      const hasResult = "result" in tool && tool.result !== null;

                      return (
                        <div key={tool.toolCallId}>
                          <ToolStateIndicator
                            toolName={tool.toolName}
                            state={hasResult ? "completed" : "running"}
                          />

                          {hasResult && tool.toolName === "searchInRAG" && tool.result && (
                            <RAGResults data={tool.result as RAGResponse} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </details>
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="msg msg-assistant">
            <div className="thinking-indicator">
              <div className="thinking-dots">
                <span />
                <span />
                <span />
              </div>
              Pensando y procesando
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {isUploading && (
        <UploadProgress
          stage={uploadStage}
          fileName={uploadFileName}
          progress={uploadProgress}
        />
      )}

      {uploadResult && !isUploading && (
        <div className={`upload-result ${uploadResult.error ? "error" : "success"}`}
          style={{ margin: "0 24px 8px" }}>
          {uploadResult.error ? (
            <>❌ Error: {uploadResult.error}</>
          ) : (
            <>
              ✅ {uploadResult.message}
              <div className="upload-result-details">
                <span>📄 {uploadResult.fileName}</span>
                <span>🧩 {uploadResult.chunks} chunks</span>
                <span>📝 {uploadResult.textLength} caracteres</span>
              </div>
            </>
          )}
        </div>
      )}

      <div className="input-area">
        <form onSubmit={onSubmit} className="input-form">
          <label className={`file-upload-btn ${isUploading ? "uploading" : ""}`} title="Subir documento (PDF, TXT, MD, DOCX)">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.txt,.md,.docx"
              onChange={handleFileUpload}
              disabled={isUploading}
            />
            📄
          </label>

          <input
            value={input}
            onChange={handleInputChange}
            disabled={isLoading}
            placeholder="Preguntá sobre tus documentos"
            className="chat-input"
          />

          <button
            type="submit"
            disabled={isLoading || !input?.trim()}
            className="send-btn"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </form>
        <div className="input-hint">
          <span>Formatos soportados:</span> PDF, TXT, MD, DOCX
        </div>
      </div>
    </div>
  );
}