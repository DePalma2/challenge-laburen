# DevOps Proposal: 

## 1. Observability

### Métricas
- **Vercel Analytics** para métricas de rendimiento web (TTFB, LCP, CLS)
- **Custom metrics** con OpenTelemetry para:
  - Latencia de embedding generation 
  - Latencia de búsqueda vectorial pgvector
  - Tiempo de respuesta del LLM 
  - Tasa de éxito/fallo de uploads por formato (PDF, TXT, MD, DOCX)
  - Hit rate del RAG (queries con resultados vs sin resultados)

### Logs
- Niveles: ERROR para fallos de API/DB, WARN para retries, INFO para flujos normales
- Centralización en **Vercel Logs** o **Elasticsearch** para búsqueda y alerting
- Correlation IDs por request para trazar el flujo completo: upload → chunking → embedding → storage

### Traces
- **OpenTelemetry SDK** integrado en Next.js para distributed tracing
- Spans por cada fase: `parseForm` → `extractText` → `generateEmbedding` → `insertDocument`
- Tracing del LLM: prompt tokens, completion tokens, tool calls, latencia por step

### Alertas
- PagerDuty/Slack alerts para: error rate > 5%, latencia p95 > 10s, DB connection failures
- Dashboard en Elasticsearch/Kibana con paneles de: requests/min, error rate, embedding costs, DB queries/s

---

## 2. Scalability

### Si el tráfico aumenta 1000× por ejemplo:

**Frontend & API:**
- Vercel escala horizontalmente de forma automática (serverless)
- Implementar **rate limiting** por IP/API key con Vercel Edge Middleware o Redis
- **CDN caching** para assets estáticos (ya incluido en Vercel)

**Base de datos vectorial:**
- Migrar de Supabase shared a **Supabase Pro/Enterprise** con connection pooling (PgBouncer)
- Implementar **read replicas** para queries de búsqueda vectorial
- Agregar índices HNSW en pgvector

**Embeddings:**
- **Batch processing** de embeddings en lugar de uno por uno
- **Cola de mensajes** (BullMQ + Redis) para procesar uploads de forma asincrónica
- **Caching de embeddings** para queries frecuentes con Redis/Upstash

**LLM:**
- Implementar **semantic cache** para respuestas a queries similares
- Request queuing con prioridad para evitar rate limits de OpenRouter

---

## 3. Reliability

### Para lograr 99.9% uptime:

**Infraestructura:**
- Vercel provee SLA de 99.99% de uptime para el edge network
- Supabase Pro ofrece 99.9% SLA para la base de datos
- Implementar **health checks** en `/api/health` que verifiquen: DB connection, OpenRouter API, pgvector extension

**Resiliencia:**
- **Circuit breaker pattern** para llamadas a OpenRouter (si falla 3 veces consecutivas, retornar error graceful)
- **Retry con exponential backoff** para embeddings y LLM calls (ya implementado parcialmente)
- **Graceful degradation**: si el RAG falla, responder sin contexto documental en vez de error 500
- **Timeouts configurables** para cada servicio externo

**Base de datos:**
- Supabase maneja backups automáticos diarios
- Point-in-time recovery activado
- Connection pooling con PgBouncer para manejar connection storms

---

## 4. Cost Optimization

### LLM Calls
- **Semantic cache**: almacenar respuestas para queries con similarity > 95% → reduce calls hasta 40%
- **Model routing**: usar modelos más baratos (Llama 3.1 8B) para queries simples, reservar modelos costosos para queries complejas
- **Prompt optimization**: reducir system prompt, enviar solo chunks relevantes en contexto

### Vector DB
- **Supabase free tier** es suficiente para desarrollo y MVP
- En producción: Supabase Pro ($25/mes) da 8GB de almacenamiento
- **Purga periódica** de documentos antiguos no consultados

### Hosting
- Vercel Hobby es gratis para proyectos personales (En uso actualmente)
- **Vercel Pro** ($20/mes) para producción con más bandwidth y edge functions
- **ISR/SSG** para páginas estáticas cuando sea aplicable

### Estimación mensual para producción moderada (~10K users/mes):
| Servicio | Costo estimado |
|----------|---------------|
| Vercel Pro | $20/mes |
| Supabase Pro | $25/mes |
| OpenRouter (Llama 3.1 8B) | ~$5-15/mes |
| OpenRouter (Embeddings) | ~$2-5/mes |
| **Total** | **~$52-65/mes** |

---

## 5. Security

### Vulnerabilidades identificadas y mitigaciones:

**API Keys expuestas:**
- API keys en variables de entorno (`.env`), nunca en código
- Mejorar: Rotar keys periódicamente, usar Vercel Environment Variables con encryption

**Inyección SQL:**
- Uso de Prisma con queries parametrizadas (`$1`, `$2`)
- El `$executeRawUnsafe` usa parameterized queries (no string interpolation)

**Upload de archivos maliciosos:**
- Riesgo: PDFs con JavaScript embebido, archivos ZIP bomb en DOCX
- Mitigar: validar magic bytes del archivo , limit file size (ya implementado)

**Rate limiting:**
- Mitigar: agregar `@vercel/edge` rate limiter o middleware custom con contador por IP

**XSS en respuestas del LLM:**
- ReactMarkdown sanitiza HTML por defecto
- Mejorar: agregar DOMPurify como capa extra

**CORS:**
- Configurar headers restrictivos en producción (solo dominio propio)

**Dependencias:**
- Ejecutar `npm audit` regularmente
- Implementar **Dependabot** para actualizaciones automatizadas

---

## 6. Testing

### Estrategia de testing propuesta:

**Integration Tests:**
- API `/api/upload`: subir archivos de cada formato, verificar chunks en DB
- API `/api/chat`: enviar query, verificar que se invoca `searchInRAG` y se persiste respuesta
- RAG pipeline end-to-end: upload → query → verify resultados con similarity > threshold

**E2E Tests (Playwright):**
- Flow completo: abrir app → subir PDF → hacer pregunta → verificar respuesta con citaciones
- Verificar UI states: loading, tool indicators, RAG results expandibles

**Load Tests (k6):**
- Simular 100 concurrent uploads para verificar bottlenecks
- Medir latencia de búsqueda vectorial bajo carga

---

## 7. Advanced CI/CD

### Mejoras al pipeline actual:

**Pre-merge:**
- Agregar **preview deployments** en Vercel para cada PR 
- **Lighthouse CI** para verificar performance scores en cada PR
- **Bundle size check** para alertar si el bundle crece significativamente
- **Prisma schema validation** antes de mergear cambios de schema

**Post-merge:**
- **Canary deployments**: deployar al 5% del tráfico primero, monitorear errores, luego al 100%
- **Smoke tests automatizados** post-deploy: hit `/api/health`, verificar que RAG responde
- **Automatic rollback** si error rate > 5% en los primeros 5 minutos

**Pipeline adicionales:**
- **Nightly builds** con tests de integración completos contra staging
- **Dependency update PRs** automáticos con Dependabot
- **Security scanning** con `npm audit` y Snyk en cada push

**Environments:**
- `development` → local con Supabase local (docker-compose)
- `staging` → Vercel preview + Supabase staging project
- `production` → Vercel production + Supabase production con backups

---

## 8. Disaster Recovery

### Plan de backup y recuperación:

**Base de datos (Supabase/PostgreSQL):**
- **Backups automáticos**: Supabase Pro incluye daily backups con 7 días de retención
- **Export manual** periódico con `pg_dump` a un bucket S3/GCS como redundancia
- **Replica cross-region** para disaster recovery geográfico

**Código y configuración:**
- Todo en **Git** (GitHub) → historial completo de cambios
- **Infrastructure as Code**: variables de entorno documentadas, schema de DB en Prisma
- **Branch protection** en main para evitar pushes directos

**Documentos indexados:**
- Los documentos originales se pueden re-subir ya que el sistema soporta re-ingesta
- Opcionalmente: guardar archivos originales en **S3/Supabase Storage** como backup
- Script de re-indexación masiva para reconstruir el vector store desde archivos originales

**Plan de recuperación:**
| Escenario | RTO | RPO | Acción |
|-----------|-----|-----|--------|
| Caída de Vercel | 0 min | 0 | Vercel auto-recupera, multi-region |
| Corrupción de DB | < 30 min | < 1 hora | PITR desde Supabase dashboard |
| Leak de API keys | < 15 min | N/A | Rotar keys en Vercel env vars, re-deploy |
| Pérdida total de datos | < 2 horas | < 24 horas | Restaurar desde pg_dump + re-indexar docs |
| Error en deploy | < 5 min | 0 | Rollback automático en Vercel (instant rollback) |

### Procedimiento de incident response:
1. **Detectar**: alertas automáticas via monitoring
2. **Comunicar**: notificar al equipo por Slack
3. **Contener**: rollback inmediato si es deploy-related
4. **Resolver**: investigar root cause con logs y traces
5. **Post-mortem**: documentar incidente y acciones preventivas
