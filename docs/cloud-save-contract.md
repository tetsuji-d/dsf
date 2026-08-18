# Studio Cloud Save Contract

## Purpose

This document defines the authoring persistence boundary used by DSF Studio.
Published DSF data and Viewer delivery remain separate from the editable source.

## Project versions

- Legacy Fixed-only projects remain Project v5. Loading or saving them does not
  implicitly upgrade them to v6.
- A project containing a top-level `kind: "flow"` group must explicitly be
  Project v6.
- Project v6, FlowDocument v1, and FlowLayout v1 are validated before any
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
- ordered mixed `blocks[]`
- Fixed compatibility `sections[]` and Page v5 `pages[]`
- project metadata, exact saved language keys, and UI preferences

The following are runtime-only and are rejected rather than silently stripped:

- generated Flow pages
- fragments and source checkpoints
- pagination results and caches

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

## Local and DSP boundaries

IndexedDB autosave, local recent projects, Firestore load, and DSP import all use
the same normalize-and-validate ingress before dispatching to Studio state.

DSP schema v1 remains readable for legacy Fixed projects. Project v6 archives
use `meta.json.schemaVersion: 2` and `project.json.version: 6`. DSF metadata and
Viewer behavior remain schema v1 in this unit.
