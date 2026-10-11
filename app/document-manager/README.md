# Knowledge Base (`document-manager`)

Curator app for the RAG knowledge corpus — the documents that ground AI
recommendations (Material Group / Commodity / Supplier enrichment, project
drafting). Fiori Elements v4 List Report / Object Page over `KnowledgeService`
(`api/knowledge/`).

The folder and app id (`poc.sp.hub.documentmanager`) keep their original names
because `mta.yaml`, the npm workspace and the FLP inbound reference them. Plan,
decisions and change log: [`../../document-manager.md`](../../document-manager.md).

## What it does

| Where | Feature | Implementation |
|---|---|---|
| List toolbar | **Upload File** — PDF/CSV/TSV/EML/JSON/TXT/MD, 10 MB; parsed server-side, embedded | `ext/fragment/UploadDialog.*` (`createFromFile` + media-stream PUT) |
| List toolbar | **Ask Knowledge Base** — Search (scored retrieval, no LLM) or Ask (grounded answer + citations) | `ext/fragment/AskDialog.*` |
| List toolbar | **Reindex Missing** — embed every document not `INDEXED` | `ext/fragment/KnowledgeActions.js` |
| List / Object Page | Create / Edit / Save (draft); saving changed title/content re-embeds | `annotations.cds`, draft-enabled entity |
| Object Page header | **Reindex** this document | bound `reindexDocument` via `UI.Identification` |
| Object Page | **Similar Documents** — nearest neighbours, ≥85 % flagged as likely duplicate | `ext/fragment/SimilarSection.*` |

Reads are open to any authenticated user; every write is `KnowledgeCurator`-only
(the server answers 403, the app explains it).

## Running locally

Start the CAP server from the project root (`cds watch`). The manifest's
dataSource URI is **relative** (`api/knowledge/`) for the managed approuter, so the
direct URL `http://localhost:4004/poc.sp.hub.documentmanager/index.html` only works
when `/<app>/api/*` is rewritten to `/api/*` (the approuter does this; headless
tests add the same rewrite). Log in with a mocked user, e.g. `curator:` (all
writes) or `requester:` (read-only).

## Layout

```
annotations.cds            UI annotations (imported via app/services.cds)
webapp/manifest.json       FE routing, toolbar actions, custom Object Page section
webapp/ext/fragment/       dialogs and the Similar Documents section
webapp/ext/lib/            ActionRunner (per-app copy of intake-hub's)
webapp/i18n/               all UI strings of the extensions
webapp/test/integration/   generated OPA journeys (scaffolding, targets KnowledgeDocuments)
```

Build for Cloud Foundry: `npm run build:cf` (called by `mta.yaml`).
