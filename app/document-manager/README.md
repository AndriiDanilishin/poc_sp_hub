> ## ⚠️ This app is a template, not a working feature
>
> `document-manager` is **Fiori generator scaffolding**, kept deliberately.
> `docs/solution-architecture.md` §29 keeps it and `DocumentService` "as the
> template for the intake pattern (upload → chunk → status) rather than
> replaced". `CLAUDE.md` calls its `workspace` namespace a Phase 0 baseline,
> "not yet the target domain".
>
> **What is real:** the CDS model (`db/schema.cds`) and the `DocumentService`
> handlers (`deleteDocument`, `getStatus`, `getDeletePreview`) — all working,
> but **no UI calls any of them**.
>
> **What is not:** the document chat. Its section is a placeholder button. The
> modules it needs (`srv/lib/embedder.js`, `srv/lib/vector_search.js`) were
> removed on this branch; the live AI stack (`srv/ai/`) targets the `sourcing`
> domain instead. The seeded rows are generator noise (`fileName816`,
> `status479`), and `webapp/test/integration/*.gen.js` is generated scaffolding,
> not test coverage.
>
> **Read `app/intake-hub/` instead.** It was built from this pattern and has
> since overtaken it — real file upload, media streams, full i18n, shared
> extension libs, Fiori-compliant Object Page header actions with `enabled`
> gating. For the current state and the options for this app's future, see
> [TASK-UX.md](TASK-UX.md).

## Application Details
|               |
| ------------- |
|**Generation Date and Time**<br>Tue Jul 14 2026 21:42:02 GMT+0000 (Coordinated Universal Time)|
|**App Generator**<br>SAP Fiori Application Generator|
|**App Generator Version**<br>1.28.0|
|**Generation Platform**<br>SAP Business Application Studio|
|**Template Used**<br>List Report Page V4|
|**Service Type**<br>Local CAP|
|**Service URL**<br>http://localhost:4004/api/documents/|
|**Module Name**<br>document-manager|
|**Application Title**<br>Document &amp; Chat Hub|
|**Namespace**<br>poc.sp.hub|
|**UI5 Theme**<br>sap_horizon|
|**UI5 Version**<br>1.150.0|
|**Enable TypeScript**<br>False|
|**Add Eslint configuration**<br>True, see https://www.npmjs.com/package/@sap-ux/eslint-plugin-fiori-tools#rules for the eslint rules.|
|**Main Entity**<br>Documents|

## document-manager

Document extraction manager with AI assistant

### Starting the generated app

-   This app has been generated using the SAP Fiori tools - App Generator, as part of the SAP Fiori tools suite.  To launch the generated app, start your CAP project:  and navigate to the following location in your browser:

http://localhost:4004/document-manager/webapp/index.html

#### Pre-requisites:

1. Active NodeJS LTS (Long Term Support) version and associated supported NPM version.  (See https://nodejs.org)



Adding a new parser — what to do
Case A: new parser for an existing origin type (e.g. a better .docx handler routed via Excel/Text)
Just two files:

Create srv/ai/document-parsers/<name>-parser.js exporting parse(input) → { text, segments }.
Register in index.js — add the require and the PARSERS entry.

Case B: brand-new origin type (e.g. Word, Html)
Five touch-points — miss any and the upload is rejected before the parser is ever reached:

#	File	Change
1	srv/ai/document-parsers/<name>-parser.js	create — export parse(input) returning { text, segments: [{text, location}] }; throw an informative Error on unsupported input
2	srv/ai/document-parsers/index.js:14-28	require it + add to the PARSERS map, keyed by the new originType
3	db/sourcing-schema.cds:13-19	add the value to the originType enum
4	srv/intake-service.js:5	add to ALLOWED_ORIGIN_TYPES (the upload gate — this is what actually blocks unknown types with a 400)
5	UI (optional)	app/intake-hub/webapp/ext/fragment/UploadDialog.fragment.xml — add the option to the origin-type picker so users can select it


