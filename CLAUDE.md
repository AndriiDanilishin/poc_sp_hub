# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A SAP CAP (Node.js) project working toward an **AI Procurement Assistant**: turn procurement requirements scattered across email, PDF, images, Excel, and partner REST feeds into a human-reviewed Sourcing Project and, on approval, a Purchase Requisition in SAP S/4HANA Cloud. AI proposes (extraction, normalization, duplicate detection, Material Group/Commodity/Supplier recommendation, project drafting); a human always approves — the AI never creates SAP business objects itself.

The full target design — business architecture, domain model, CDS entities, AI/RAG architecture, S/4HANA integration, security, roadmap — is in **[docs/solution-architecture.md](docs/solution-architecture.md)**. Read it before making architectural decisions; this section only summarizes where the code currently stands relative to it.

**Current state (Phase 0 baseline, not yet the target domain)**: what's actually implemented today is a generic document-upload + RAG-chat scaffold called "Document & Chat Hub" (`poc.sp.hub`) — upload a document, chunk it, embed the chunks, chat with it via retrieval-augmented Q&A. It has no procurement/sourcing domain logic; treat it as the technical template for the target `IntakeService` (upload → chunk → status pattern), not as existing business functionality.

Much of the AI/RAG logic is not yet implemented: `srv/lib/embedder.js` and `srv/lib/vector_search.js` are empty stub files, and the Fiori chat UI extension (`ChatSection.js`) is generator-scaffolded placeholder code (a button wired to a `MessageToast`). The CDS data model and the document CRUD/status/delete actions in `srv/document-service.js` are the only fully working parts.

Per the roadmap in `docs/solution-architecture.md` §29, upcoming work replaces the `workspace` namespace with the `sourcing` domain model (§10) and adds `IntakeService`/`WorkspaceService`/`SourcingProjectService`/`KnowledgeService` alongside — the existing `DocumentService` is kept as the intake pattern template, not deleted.

**Sourcing domain — built so far**: `db/sourcing-schema.cds` (namespace `sourcing`, the full §10 model) plus four CAP services, each `.cds` + `.js`:

- `IntakeService` (`/api/intake`) — `uploadDocument`, `extractRequirements`, `getExtractionStatus`.
- `WorkspaceService` (`/api/workspace`) — CRUD over `RequirementWorkspaces`/`WorkspaceRequirements` + `merge`/`split`/`reject`/`regenerate`/`promoteToSourcingProject`. A `before UPDATE` hook auto-marks edited rows `aiStatus='EDITED'`; deletes and mutations are written to `AuditLog`.
- `SourcingProjectService` (`/api/sourcing`) — CRUD over the project + its composition children and read-only master data + `generateDraft`/`approve`/`submitToS4`.
- `KnowledgeService` (`/api/knowledge`) — `@requires: 'KnowledgeCurator'`; `indexDocument`/`reindex`/`listByCategory` over the curated `KnowledgeDocument` corpus.

**Convention for not-yet-built AI/integration steps**: operations that depend on the Phase 2+ AI modules (`srv/ai/*`, the embedder) or the Phase 5 S/4HANA call are implemented as deliberate stubs — they validate inputs and existence first, then `req.reject(501, '... not implemented yet (Phase N)')`. This currently covers `extractRequirements`, `WorkspaceService.regenerate`, `SourcingProjectService.generateDraft`, `submitToS4`, and `KnowledgeService.reindex`. Guardrail gates that don't need AI are real and enforced now (e.g. `submitToS4` requires status `APPROVED`; `promoteToSourcingProject` blocks unreviewed low-confidence items).

**Dev auth**: `package.json` `cds.requires.auth` now configures `kind: mocked` with three test users — `curator` (KnowledgeCurator), `requester` (ProcurementRequester), `manager` (ProcurementRequester + ProcurementManager). Use these for HTTP Basic auth in local testing (e.g. `curl -u curator: ...`); production still uses `xsuaa`. Only `KnowledgeService` currently sets `@requires`; the other services are open in dev.

**AI module (`srv/ai/`) — in progress**: every AI capability goes through one adapter, `srv/ai/llm-client.js` (§14) — `chat({system, user, schema, ...})` returns a schema-validated object (single retry on invalid JSON, §16); `embed(text)` returns a `Vector(3072)`-compatible array. It selects a **provider** from config/env (`AI_PROVIDER`): `openai` (native `fetch`, no SDK dependency, needs `OPENAI_API_KEY`) or `mock` (deterministic, offline — **the default**, so dev/CI run with no key and no network). Guardrails baked in (§25): output-token cap, input-size guard, clear failure when the OpenAI key is missing. Config knobs via `cds.env.ai` or env vars (`AI_CHAT_MODEL`, `AI_EMBED_MODEL`, etc.). The module includes a tiny built-in JSON-schema validator (exported as `.validate`) — no `ajv` dependency.

Built on the adapter so far:

- `srv/ai/extraction.js` — `extractRequirements(text)` → `{ requirements: [...] }` (each with description/quantity/unit/requestedDate/rawSnippet/confidence), temperature 0.1, strict schema, defensive normalization (confidence clamped 0..1, dates → ISO or null). Pure logic — no DB/OData knowledge; the service maps its output to `WorkspaceRequirement`/`RequirementSource` rows (§18).
- `srv/ai/document-parsers/` — registry (`parseDocument({originType, fileType, buffer, text})`) → `{ text, segments }`, where each segment has a `location` (subject / paragraph N / row N / page N) for `RequirementSource` traceability (§17). **Email/text/REST/CSV-TSV are fully implemented dependency-free**; PDF lazily requires `pdf-parse`, `.xlsx` needs the `xlsx` package, and image OCR throws a Phase-2 message — all with informative errors, not silent failures.
- `srv/ai/embedder.js` — embedding + RAG retrieval over the curated `KnowledgeDocument` corpus (§15). `embed(text)`, `indexDocument(id)`, `reindex({onlyMissing})`, and `search(queryText, {category, topK, minScore})`. Note: on the dev **sqlite** driver a `Vector(3072)` column round-trips as a **JSON string**, so read-back is parsed and cosine similarity is computed in JS (correct + portable at PoC corpus size; on HANA prod, push `COSINE_SIMILARITY` into SQL for scale). `search` returns top-K with no score floor by default; pass `minScore` to threshold. This is the file that will make `KnowledgeService.reindex` real and ground `enrichment`/`project-drafting`. **Not the same as** the empty legacy `srv/lib/embedder.js` (chat-scaffold stub).

- `srv/ai/duplicate-detection.js` — `detectDuplicates(requirements, {threshold})` (§3 step 4, §18). Combines three explainable signals — semantic cosine (via embedder), lexical Jaccard of description tokens, structural unit/quantity match — and returns `{ pairs, assignments }`: scored pairs with human-readable `reasons`, plus union-find `assignments` proposing each duplicate's canonical `duplicateOf` (lowest index in the group). Only proposes; merging stays a human act (`WorkspaceService.merge`, §25). Pure logic, no DB. The three-signal blend degrades gracefully — lexical+structural still catch near-dups even when semantic embeddings are unavailable (as under the mock provider).

- `srv/ai/enrichment.js` — `enrichRequirement(requirement, {topK, maxPerType})` (§5, §15, §16). RAG-grounded: one `embedder.search` per type (MaterialGroupCatalog / CommodityTaxonomy / SupplierProfile), then `llm-client.chat` (temp 0.3, strict schema) returns ranked `materialGroups`/`commodityCodes`/`suppliers`, each with clamped confidence and a `citation` to the knowledge `sourceRef`. Also returns `grounding` (the retrieved sourceRefs per type) for auditability. Proposes only (§25). This is what `WorkspaceService.regenerate` will call.

- `srv/ai/project-drafting.js` — `draftSourcingProject(requirements, {topK, maxRisks, workspaceTitle})` (§20, §16). RAG-grounded in `Guideline` + `PastProject` knowledge, `llm-client.chat` (temp 0.5, strict named-field schema) proposes title/description/category/priority (`Low|Medium|High`) / timeline (ISO or null) and a `risks` list (each with a `Low|Medium|High|Critical` severity + mitigation), plus `grounding` sourceRefs. Proposes only; the service marks persisted rows `aiGenerated=true`. This is what `SourcingProjectService.generateDraft` will call.

**All pure-AI modules under `srv/ai/` are now built and validated.** Date normalization is strict on purpose: `new Date()` leniently accepts junk (e.g. `"mock-42"` → year 2041, `"mock-213161"` → year 213161), so `toIsoDateOrNull` (in `extraction.js` and `project-drafting.js`) requires an ISO leading date and a plausible year (1970–2100) before trusting a value. Note: `clamp01`, `toIsoDateOrNull`, and the RAG `formatContext` helper are currently duplicated across a few AI files — a candidate for extraction into a shared `srv/ai/util.js`.

Not built yet: the wiring that turns the 501 stubs real — `IntakeService.extractRequirements` (needs a text source: a parser call plus a `content` field on `SourceDocument`, which stores metadata only today), `KnowledgeService.reindex` (call `embedder.reindex()`), `WorkspaceService.regenerate` (call `enrichment.enrichRequirement`), `SourcingProjectService.generateDraft` (call `project-drafting.draftSourcingProject`).

**Validation harnesses** for the AI files live in the session scratchpad (not committed): they run each module offline against the mock provider. There is no committed test runner yet.

## Commands

- `npm start` — run the CAP server via `cds-serve` (production-style entry point).
- `cds watch` — run the CAP server in dev/watch mode (auto-restart on file changes); serves at `http://localhost:4004`.
- `npm run watch-document-manager` — `cds watch` and open the `document-manager` Fiori app directly (`poc.sp.hub.documentmanager/index.html`, live reload disabled).
- `npm run lint` / `npm run lint:fix` — ESLint over `srv/`, `db/`, `test/`, and root files, using `@sap/cds`'s own flat config (`eslint.config.mjs`, recognizes CDS query globals like `SELECT`/`DELETE`). Deliberately excludes `app/**` — the `document-manager` app has its own separate ESLint config (`app/document-manager/eslint.config.mjs`, `@sap-ux/eslint-plugin-fiori-tools`) for UI5/Fiori conventions; run via `npx eslint .` from that directory if needed.
- `npm run format` / `npm run format:check` — Prettier over the same scope (`.prettierrc.json`); `.prettierignore` excludes `app/document-manager/` (generator-managed) and editor/tool state.
- No test runner is configured yet.
- `app/document-manager/webapp/test/integration/` contains OPA5 journey tests generated by the Fiori Application Generator (`*.gen.js`) — these are scaffolding, not hand-written test coverage.

## Architecture

**Service boundary**: single CAP service, `DocumentService`, mounted at `/api/documents` (`srv/document-service.cds` + `srv/document-service.js`). The `Documents` entity is exposed as a projection (excluding the `chunks` composition); chunks, chat sessions, and messages are managed internally through custom actions/functions, not exposed as separate service entities.

**Data model** (`db/schema.cds`, namespace `workspace`):

- `Documents` → composition of many `DocumentChunks` (chunking + embedding status lives on the parent: `status`, `chunkCount`, `errorMsg`).
- `DocumentChunks.embedding` is a `Vector(3072)` column (OpenAI `text-embedding-3-large` dimensionality) for similarity search — this is what `srv/lib/vector_search.js` and `srv/lib/embedder.js` are meant to populate/query once implemented.
- `ChatSessions` optionally link to a `Documents` record and composition-own many `ChatMessages` (each message has a `role`, `content`, and an optional `sources` field for citing retrieved chunks).
- Cascading delete is handled manually in application code (`deleteDocument` action in `document-service.js`), not via DB-level cascade: it deletes messages → sessions → chunks → the document, in that order, because compositions alone don't cascade across the session/document link.

**Persistence**: SQLite for local dev (`@cap-js/sqlite`), HANA Cloud in production (`@cap-js/hana`). Auth is `xsuaa` only under `[production]` profile (see `package.json` `cds.requires`); local dev runs unauthenticated. `xs-security.json` currently defines no scopes/role-templates — authorization is not yet modeled.

**Frontend** (`app/document-manager/`): a Fiori Elements List Report / Object Page app (SAPUI5 1.150, `sap.fe.templates`) generated with the Fiori Application Generator, backed by `mainService` = the `/api/documents/` OData service. Custom UI beyond the generated CRUD screens is added via the Object Page's `content.body.sections` extension in `manifest.json` (`ChatSection`), which loads a fragment + controller extension from `webapp/ext/fragment/`. Field/list annotations for `Documents` (labels, line items, facets) live in `app/document-manager/annotations.cds`, imported into `app/services.cds`.

**Test data**: `test/data/workspace-*.csv` provides seed rows for all four entities, useful for local `cds watch` runs without needing the upload/extraction pipeline to work end-to-end.
