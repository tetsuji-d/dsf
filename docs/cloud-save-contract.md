# Studio Cloud Save Contract

## Purpose

This document defines the authoring persistence boundary used by DSF Studio.
Published DSF data and Viewer delivery remain separate from the editable source.

## Project versions

- Legacy Fixed-only projects remain Project v5. Loading or saving them does not
  implicitly upgrade them to v6.
- A project containing a top-level `kind: "flow"` group must explicitly be
  Project v6.
- Project v6, FlowDocument v1–v4, and FlowLayout v1/v2 are validated before any
  state mutation or persistence write. Unsupported future versions fail closed.

## Private R2 authoring (scoped rollout)

Existing unmarked v5/v6 projects keep their Firestore contract. New projects use
private R2 when the build flag and authenticated owner rollout are enabled; see
[New project creation](private-authoring-new-projects.md).
 A root explicitly
marked `authoringBackend: "r2-private"`, `authoringStorageVersion: 1`,
`authoringRef: "authoringHeads/current"` uses the authenticated same-origin API.
Partial or unsupported migration markers fail closed. Studio never automatically
migrates a project, changes its generation, or falls back to Firestore after an
R2 read/write error. Missing private data does not become an empty project.

The API validates the current Firebase identity/account and reads/writes the
immutable JSON object in a separate private R2 binding. The source head, generation,
request ledger, usage and metadata transactions are server-owned. Neither full
source nor the R2 object key belongs in the public root. Studio validates returned
size, SHA-256, scope and schema before loading the project into editor state.

IndexedDB backup precedes cloud saving. The loaded generation/revision and pending
immutable save request live only in the open editor session, outside authoring
state and export files. Repeated saving first resolves the same pending request;
new edits wait for that result. Conflicts, expired operations and stale sessions
never automatically adopt a newer cloud base. Reloading a local backup cannot
silently overwrite a migrated cloud project: export/retain the local draft first,
then explicitly open the cloud project again. No automatic merge is implemented.

Cloud failure rejects `flushSave`; it is not reported as successful saving merely
because the local backup succeeded. Late responses after project load or auth
changes do not change the active editor's cloud-save status. Edits during saving
remain pending until the serialized save loop handles their snapshot.

Production migration also supports Fixed-only Project v5 without converting its version.
Legacy Japanese project/work IDs remain unchanged; path separators and URL escapes are rejected.
A v5 rollback restores the source to the root, while v6 restores `authoring/current`.

The limit for migrated JSON is 16 MiB; the old 850 KiB limit still applies to
Firestore v6. Asset blob URLs must resolve successfully before uploading private
JSON. Missing image data stops the cloud save instead of erasing references.
The original local image mapping remains available for recovery; successful URL
resolution is reused within that editor session.

Rules block migrated roots/old authoring writes, old authoring reads, summary writes,
and direct access to the new server-owned paths. Associated Work/Release/public
listing client writes use the Unit D action adapters. Normal reader access and
staff takedown authority are preserved; migrated public snapshots cannot be
rewritten through the legacy admin resync. The API requires explicit enablement and an owner or project allowlist. No migration, Rules deployment, bucket,
secret or live account configuration is performed by Unit C.

See [Unit C implementation and verification](private-authoring-storage-unit-c.md).
Unit F verified a single staging fixture through real Firebase/R2, Studio/Press,
and rollback to Firestore. The final staging API is disabled after that rollback;
production and existing works are not migrated. See [Unit F results](private-authoring-storage-unit-f.md).

### Migrated project lifecycle (Unit D)

The same-origin `/api/projects/{projectId}/actions` endpoint serves owner action
context (GET) and typed draft/publication/listing/profile/delete/restore commands
(POST). Every mutation carries an immutable request ID, authoring generation,
source base revision and metadata mutation revision. Server transactions own
root/summary/Work/Release/public-index updates. Stale retries cannot report an old
successful state after another write. Publication permissions, plan dates and
profile come from the current account, not caller-supplied account data.

Draft creation reads the saved private source, verifies real release objects in
the public bucket, and commits metadata with the captured source revision. Private
source JSON is never copied into a public listing or Release. Delete removes the
root, summary and public indexes atomically and retains a deletion control record;
physical object/ledger retention is Unit E. Restoring the immediately previous
source creates a new immutable revision via the normal save protocol and preserves
publication state. The editor must load that revision again before further saves.

See [Unit D implementation and verification](private-authoring-storage-unit-d.md).

### Unit E maintenance (operator only, not activated)

Migration backs up typed Firestore documents, verifies private R2 bytes, and checks
original document update versions before atomically changing the storage head.
Rollback copies the **current** R2 source into Firestore only when it fits the
850 KiB authoring limit. A retained `rolledBack` control and matching
`authoringRollbackGeneration` permit legacy owner saves while rejecting late R2 writes.
Maintenance ledgers are server-only. Retention inventory is read-only; it cannot
remove objects or refund quota. Rules and live migration remain undeployed.
See [Unit E protocol, retention and recovery](private-authoring-storage-unit-e.md).

API activation, real migration and Rules deployment remain separate rollout work.

## Firestore ownership boundary

`users/{uid}/projects/{pid}` can be publicly readable after publication, so it
must not contain Flow semantic source.

For Project v6 using the legacy Firestore backend:

```text
users/{uid}/projects/{pid}
  explicit public-field allowlist + Fixed compatibility projection
  version: 6
  authoringRef: "authoring/current"
  authoringSchemaVersion: 6

users/{uid}/projects/{pid}/authoring/current
  owner-only complete Project v6 authoring envelope
  blocks[] contains the ordered Fixed/Flow spine
```

The root and `authoring/current` are written in one Firestore batch. The child
document is the authoring source of truth. If the root declares the child and it
is missing, Studio stops loading instead of falling back to the public Fixed
projection.

Fixed v5 continues to use the project root as before. Root writes use merge
semantics so Press fields are not dropped by a fragile client-side allowlist.

## What is persisted

- Flow Group `flow.document` semantic source
- Flow Group `flow.layout`
- optional Flow Group `flow.translationState` v1 source fingerprints and review/lock metadata
- ordered mixed `blocks[]`
- Fixed compatibility `sections[]` and Page v5 `pages[]`
- project metadata, exact saved language keys, and UI preferences

The following are runtime-only and are rejected rather than silently stripped:

- generated Flow pages
- fragments and source checkpoints
- pagination results and caches
- translation provider/model/endpoint settings and translation job progress/error/cancel state

Commit 8B-2C-Aのprovider registry、model discovery、Flow translation request、target snapshot、
provider response、atomic apply planもこのruntime-only境界に含む。これらはStudioへ接続する前の純粋な実行契約であり、
Project v6や`flow.translationState`へ追加fieldを作らない。

Commit 8B-2C-BでStudioへ接続したprovider／model選択、model一覧、job進捗、error、cancel stateも保存しない。
成功時に保存されるのは既存FlowDocument内の言語別`title`／`texts`と、既存schemaの
`flow.translationState` machine／mixed freshness metadataだけである。schema versionと公開root境界は変更しない。

The public project root is built from an explicit public-field allowlist. It
contains the Fixed compatibility projection, but no Flow group or unknown
authoring extension. Unknown authoring fields remain round-trippable only in the
owner-only child. Published DSF pages remain the existing WebP projection and
are not changed by Commit 6B. Projects containing a Flow group cannot be sent to
Press until the generated-page renderer is connected; Studio fails closed
instead of publishing a Fixed-only projection that omits the Flow source.

## Size and failure behavior

Before writing `authoring/current`, Studio measures its UTF-8 JSON size and uses
an 850 KiB soft limit. This leaves room below Firestore's document limit for
field names and encoding overhead. Over-limit Flow source still remains in the
local IndexedDB backup and can be exported as DSP; only the cloud write fails.

Flow translationState uses one compact fingerprint per tracked Block or Section
title and target language. It must not duplicate source/target prose or repeat
provider metadata per unit. The 8B-2A conservative 100-Section/1,000-Paragraph
fixture measures about 45 KiB for one target language's translationState and
about 280 KiB for the complete Project v6 envelope. A conservative fixture with
UUID-length IDs and five target languages measures about 357 KiB of translation
metadata and 902 KiB total, so the existing guard rejects its cloud write while
local IndexedDB and DSP serialization remain available. Supporting that scale
in cloud authoring requires a future split of the owner-only authoring child.

## Version downgrade protection

Firestore Rules require project versions to be monotonic on update. In
particular, an old v5 client cannot replace a v6 project root. Merge updates from
Press keep the existing version and remain valid. The same owner-only rules
protect `authoring/current`.

Project deletion removes `authoring/current` and the project root in one batch.
Rules reject deletion of the root while that child would remain.

## Deployment order

The matching Firestore Rules must be deployed before a Project v6 Studio
client. After the root plus `authoring/current` atomic-write contract is
verified, the Studio client can be deployed. Commit 6B itself does not deploy
Rules or application code.

### Dashboard project summary rollout

`users/{uid}/project_summaries/{pid}` is an owner-only, maximum 32 KiB list
projection. It never replaces the project root or `authoring/current` and must
not contain `blocks`, `sections`, `pages`, `dsfPages`, `meta`, or
`authoringRef`.

Roll it out in this order:

1. Define and verify the pure projection without Firestore writes.
2. Deploy owner-only Firestore Rules for the summary path.
3. Add atomic summary writes to every root-metadata writer and project delete.
4. Read summaries first in Dashboard, retaining root fallback for old projects.
5. Backfill existing projects, then remove fallback only after coverage is measured.

Steps 1 and 2 are complete in staging. Step 3 is implemented by adding the
summary to the same Firestore batch as every project-root metadata write and
project deletion. The dual-write client has not been deployed to Cloudflare
Pages yet; Dashboard reads and backfill remain unchanged.

## Local and DSP boundaries

IndexedDB autosave, local recent projects, Firestore load, and DSP import all use
the same normalize-and-validate ingress before dispatching to Studio state.

DSP schema v1 remains readable for legacy Fixed projects. Project v6 archives
use `meta.json.schemaVersion: 2` and `project.json.version: 6`. DSF metadata and
Viewer behavior remain schema v1 in this unit.


## Anchored Flow graphics (FlowLayout v2)

The approved [Flow wrapping contract](flow-wrap-integration-contract.md) extends only the Flow layout authoring snapshot.
Groups using anchored graphics persist `flow.layout.schemaVersion: 2` and `anchoredObjects` through the existing owner-only `authoring/current` path.
Full WebP images use the existing `projectAssets` mapping. Runtime pages, wrap regions and capture snapshots are not saved.
Project v6, Firestore collections, Rules and public root projections are unchanged. Layout v1 remains readable; v2 is never silently downgraded.
Public delivery contains fixedText and sealed background WebP assets, not the authoring Flow layout.


## FlowLayout v3：複数配置と画像キャプション

2026-09-11承認済み。v1/v2の読み込みを維持し、新しい画像操作時に対象Groupのみv3へ移行する。
`anchoredObjects[].graphic.caption`に配置方向・言語別文字列・文字サイズ・間隔・色・揃えを保存する。
同一段落の複数配置を許可する。公開配信ではキャプションを画像背景へ合成し、本文はfixedTextを維持する。
Project/Firestore Rules変更はない。詳細は[画像キャプション仕様](flow-image-captions.md)。


### Shared authoring foundation (2026-09-22, not routed)

The authoring service accepts an optional server-only access resolver. Existing
owner-only HTTP routes do not pass it and retain their current behavior.
`server/shared-authoring.js` binds a space/work to the canonical owner/project,
reconciles the existing assignment and checks the caller's current membership.
Authentication always verifies the actual caller; immutable objects and metadata
remain under the storage owner's paths. Shared operations record actorUid.
Permission is checked before reads and after R2 I/O, and on both save reservation
and final commit. A revocation prevents response/commit; no automatic fallback or
copy into the participant's personal project is allowed.
This has been tested with the real storage service and fixture R2, not deployed.
Shared images, client sessions and server-owned binding management remain required
before enabling cross-account authoring. See [invitation foundation](publishing-invitations.md).


### 共有セッションと非公開画像の接続基盤（2026-09-22、未一般提供）

共有専用client sessionは実操作UIDでtokenを取得し、server contextで確定した保存所有者UIDでheadを検証する。
既存owner-only APIへ参加者UIDを偽装して送ることはない。共有clientは新規project作成を提供しない。
共有HTTPの原稿GET/PUTには非公開画像参照の検査が入り、未移行の公開画像URLを許可しない。
画像upload/readは非公開bucketだけを使い、I/O前後の権限・世代照合を必須にする。
非公開image objectを検証してからready記録を確定し、readyでない参照は原稿保存できない。
原稿更新と画像の追加は別段階。画像だけのアップロードは原稿headを変更しない。
詳細・残作業は [招待と共有基盤](publishing-invitations.md) 第3単位を参照。


## Shared Studio exception (local rollout)

The shared editor session uses the participant's Firebase identity and the server-resolved
owner/project scope. It saves only through `/api/spaces/{spaceId}/works/{workId}/authoring`.
Unlike personal authoring, it does not write `dsf_autosave` or local recent-project snapshots,
and never falls back to the participant's personal Firestore or public asset uploads.
Private image references are hydrated to session object URLs and resolved back before saving.
See [publishing invitations, unit 4](publishing-invitations.md) for the feature gate and limits.


### Shared editing lease (local unit 5)

The shared HTTP entry point requires a per-tab editing lease for source and image writes.
Its fencing token is checked at reservation and commit, in addition to source revision CAS.
A handover flushes pending saves; the recipient reloads the latest source before editing.
Connection failures retain the unsaved in-memory draft as read-only; reacquisition does not
silently discard it. Read-access revocation still clears the shared manuscript and object URLs.
The lease expires after 90 seconds without renewal; 30 minutes without editing also permits takeover.
Unit 6 closes alternative owner-only source and mutation routes for canonically shared works.
Owners enter the same shared editor and must explicitly acquire its lease. Personal catalogue
assignments without a canonical shared binding retain their previous behavior.
Protocol and fixture-only metadata are documented in [unit 5](publishing-invitations.md).

### Owner boundary for shared works (local unit 6)

Owner API source loads return `SHARED_AUTHORING_REQUIRED` with a validated shared scope;
Studio follows it only when shared Studio is enabled. Owner mutations reject canonical shared
bindings both before I/O and at commit. A released or expired lease does not reopen owner writes.
A leftover lock without a valid binding fails closed with `SHARED_SCOPE_UNAVAILABLE`.
The owner API's REST adapter explicitly permits reads of the canonical work/space/label roots.
This does not activate shared routes, migrate assets, or change deployed Rules. Shared publication
and restore remain unavailable. See [unit 6](publishing-invitations.md) for scope and verification.

### Allowlisted shared runtime and registration (unit 7, disabled by default)

The Pages `/api/spaces/*` entry point uses real Firebase token verification, live-account checks,
the transactional Firestore adapter, and the distinct private authoring bucket. Both
`SHARED_AUTHORING_ENABLED=true` and an exact work/storage/actor allowlist are required.
Every shared transaction pins the canonical binding to the configured owner/project.
Owner-only prepare/register calls atomically establish the previously documented work binding
and index, after source verification and a final revision check. Initial registration accepts
only image-free private manuscripts; it does not migrate source, images, publication, or membership.
Legacy assignment refuses moves for shared works. Current environment flags and Rules are unchanged.
Details and remaining rollout prerequisites: [unit 7](publishing-invitations.md).


### Dashboard read path

Dashboard project lists use a Firestore REST structured query with a field projection and
Firebase ID token. The owner-only Firestore Rules still authorize every request; no server
credential is sent to the client and no Rules changes are required. Legacy v5 manuscript
blocks/pages/sections are excluded before transfer, not merely discarded after downloading.
The query retains listing metadata and published page references for legacy thumbnail fallbacks.
Each attempt has an actual abort deadline, with one retry for transient failures; permission
failures are not retried. Account changes discard responses. The existing 30-second in-memory
cache survives view/filter changes, while explicit refresh invalidates it. A failed load can
be retried from navigation or when connectivity returns without reloading the browser.
