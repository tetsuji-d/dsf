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

## Firestore ownership boundary

`users/{uid}/projects/{pid}` can be publicly readable after publication, so it
must not contain Flow semantic source.

For Project v6:

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
