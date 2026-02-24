# Challenge Laburen - AI RAG Agent.

Chatbot con capacidades RAG que permite subir documentos y consultar su contenido mediante búsqueda semántica con pgvector.

## Stack Tecnológico

| Capa | Tecnología |
|------|-----------|
| Frontend | Next.js 16 + React 19 + TypeScript |
| LLM | Meta Llama 3.1 8B via OpenRouter |
| Embeddings | OpenAI text-embedding-3-small (768d) via OpenRouter |
| Vector DB | PostgreSQL + pgvector (Supabase) |
| ORM | Prisma |
| Streaming | Vercel AI SDK v4  |
| Deploy | Vercel |
| CI/CD | GitHub Actions |

## Funcionalidades

- **Upload de documentos**: soporte para PDF, TXT, MD, DOCX
- **Chunking inteligente**: división por párrafos con agrupación para chunks óptimos de ~800 caracteres
- **Embeddings vectoriales**: generación y almacenamiento con pgvector (768 dimensiones)
- **Búsqueda semántica**: cosine similarity para encontrar los 5 chunks más relevantes
- **Streaming real-time**: respuestas del LLM en tiempo real con protocolo de streaming
- **Tool calling**: el LLM usa `searchInRAG` automáticamente cuando necesita contexto documental
- **Citación de fuentes**: cada respuesta incluye fuente, similarity score y metadata del chunk
- **Persistencia**: conversaciones guardadas en PostgreSQL (Supabase)

## Desarrollo Local

### Prerrequisitos
- Node.js 20+
- Cuenta de Supabase con pgvector habilitado
- API Key de OpenRouter

### Setup

```bash
git clone https://github.com/tu-usuario/challenge-laburen.git
cd challenge-laburen
npm install
```

Crear archivo `.env`:

```env
DATABASE_URL="postgresql://..."
OPENROUTER_API_KEY="sk-or-v1-..."
```

Generar Prisma Client y aplicar schema:

```bash
npx prisma generate
npx prisma db push
```

Iniciar servidor de desarrollo:

```bash
npm run dev
```

## Deployment

### Automatizaciones implementadas

#### 1. GitHub Actions CI/CD Pipeline (`.github/workflows/ci-cd.yml`)

El pipeline tiene 4 jobs que se ejecutan en cada push/PR a `main`:

```
push/PR → lint-and-typecheck → build → deploy (solo main)
                               ↓
                          db-migrate (solo main)
```

| Job | Qué hace |
|-----|----------|
| `lint-and-typecheck` | Ejecuta ESLint y TypeScript compiler para validar código |
| `build` | Instala deps, genera Prisma Client, compila Next.js |
| `deploy` | Usa Vercel CLI para deploy a producción |
| `db-migrate` | Ejecuta `prisma db push` para sincronizar schema con la DB |

#### 2. Vercel (Hosting & Deploy)

**Por qué Vercel:**
- Integración nativa con Next.js (mismos creadores)
- Deploy automático en cada push a main
- Preview deployments en cada PR
- Edge network global con CDN
- Serverless functions para API routes (`/api/chat`, `/api/upload`)
- Zero-config SSL/HTTPS
- Instant rollback en caso de error

#### 3. Supabase (Base de datos)

**Por qué Supabase:**
- PostgreSQL managed con pgvector pre-instalado
- Connection pooling con PgBouncer incluido
- Backups automáticos diarios
- Dashboard para monitoreo de queries
- Free tier generoso para desarrollo

#### 4. OpenRouter (LLM & Embeddings)

**Por qué OpenRouter:**
- Acceso a múltiples proveedores (Meta, OpenAI) con una sola API key
- Fallback automático entre proveedores
- Pricing transparente por token
- API compatible con OpenAI SDK

### Flujo de Deploy

```
Developer pushes to main
         │
         ▼
  GitHub Actions trigger
         │
         ├─→ Lint & TypeCheck
         │         │
         │         ▼
         │      Build Next.js
         │         │
         │         ▼
         │   Deploy to Vercel ──→ Production URL live
         │
         └─→ Run DB Migrations ──→ Schema synced with Supabase
```

### Secrets necesarios en GitHub

| Secret | Descripción |
|--------|------------|
| `VERCEL_TOKEN` | Token de la API de Vercel |
| `DATABASE_URL` | Connection string de Supabase |
| `OPENROUTER_API_KEY` | API key de OpenRouter |

### Deploy manual

```bash
npm i -g vercel
vercel --prod
```

---

## Arquitectura

```
┌─────────────────────────────────────────────────┐
│                   Frontend                       │
│            Next.js + React + AI SDK              │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │  Upload   │  │   Chat   │  │  RAG Results  │  │
│  │ Component │  │ Component│  │   Component   │  │
│  └────┬─────┘  └────┬─────┘  └───────────────┘  │
│       │              │                            │
└───────┼──────────────┼────────────────────────────┘
        │              │
        ▼              ▼
┌──────────────┐ ┌──────────────┐
│ /api/upload  │ │  /api/chat   │
│              │ │              │
│ formidable   │ │  streamText  │
│ pdf-parse    │ │  tool calls  │
│ chunking     │ │  persistence │
│ embeddings   │ │              │
└──────┬───────┘ └──────┬───────┘
       │                │
       ▼                ▼
┌─────────────────────────────────┐
│      OpenRouter API              │
│  ┌─────────────┐ ┌───────────┐  │
│  │  Embeddings │ │  LLM Chat │  │
│  │  3-small    │ │ Llama 3.1 │  │
│  └──────┬──────┘ └───────────┘  │
└─────────┼───────────────────────┘
          │
          ▼
┌─────────────────────────────────┐
│     Supabase (PostgreSQL)        │
│  ┌──────────┐ ┌──────────────┐  │
│  │  Chat &   │ │  Document    │  │
│  │ Messages  │ │  + pgvector  │  │
│  └──────────┘ └──────────────┘  │
└─────────────────────────────────┘
```

## Documentación adicional

- [DevOps Proposal](./devops-proposal.md) - Reflexión sobre mejoras para producción
