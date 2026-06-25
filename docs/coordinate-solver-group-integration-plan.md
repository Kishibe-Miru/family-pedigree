# Coordinate Solver Group Integration Plan

This document plans how `coordinateSolver.ts` should eventually consume `RelationshipGroupModel`. It is a planning contract only. It does not change the current layout pipeline, node coordinates, relationship segment geometry, renderer behavior, or UI behavior.

## 1. Current Problem

The current solver is usable, but it carries growing risk because complex pedigree behavior is mostly handled through multiple post-processing, repair, alignment, and compaction passes. Local coordinate fixes can make one relationship look better while weakening another.

The most sensitive areas still lack one shared constraint model:

- sibling spacing
- married-sibling subfamily space reservation
- spouse-origin family separation
- parent drop routing

The known complex fixture should not be fixed by adding another narrow special-case, nudge, or repair pass at the end of the solver. The next solver work should first make these semantic boundaries visible.

## 2. RelationshipGroupModel As Solver Input Contract

`RelationshipGroupModel` is a future solver input contract. It is not a UI or renderer model.

It includes:

- `groups`
- `boxes`
- `constraints`
- `roles`
- semantic views
- `linkedFamilyGroupId`
- `requiresDescendantSpace`

These fields give the solver explicit semantic units:

- Family, union, sibling, and subfamily boxes are future spacing units.
- `origin-family` semantic views prevent duplicate physical boxes for the same source family.
- Role metadata distinguishes spouse, origin child, sibling, subfamily root, and descendant roles for the same person across different groups.
- `requiresDescendantSpace` distinguishes no-child married unions from subfamilies with descendants.
- Constraints describe semantic boundaries that a group-aware solver must preserve.

The current renderer should continue to consume finalized `LayoutResult`, not `RelationshipGroupModel`.

## 3. Proposed Phased Integration

Integration should be phased. Do not switch the solver to groups in one PR.

### Phase 0: Diagnostics Only

- `computeLayout()` keeps using the existing coordinate logic.
- Tests or an optional dev-only path build `RelationshipGroupModel`.
- Diagnostics derive current family, union, sibling, and subfamily bounds from existing `LayoutResult` node positions.
- Diagnostics only report invariant violations. They do not change coordinates.

This is the next safe code PR.

### Phase 1: Derive Group Boxes From Current Layout

- Compute group box bounds from existing node positions.
- Family boxes, union boxes, sibling boxes, and subfamily boxes are derived bounds only.
- Do not change initial coordinate assignment.
- Do not change `relationshipSegments`.

Implemented derived-only entry point:

```text
src/layout/groupBoxBounds.ts
deriveGroupBoxBounds(layout, groupModel)
```

These bounds are diagnostic/planning data. They are not connected to `computeLayout()`.

### Phase 2: Use Boxes For Spacing Decisions

- Start with one minimum solver behavior: married-sibling subfamilies reserve horizontal space.
- The goal is to keep a married sibling's small family from being compressed into the source sibling row.
- Do not handle spouse-origin parent drop routing in the same PR.

Current implementation status:

- Sibling row spacing now treats a child family with descendants as a footprint to reserve, not as a single person symbol.
- Diagnostics verify `married-sibling-with-own-child` no longer reports `subfamily-space-collapsed`.
- Spouse-origin parent drop routing remains out of scope for this phase.

### Phase 3: Route Parent Drops Within Group Boundaries

- After family and subfamily boxes are stable, handle spouse-origin parent drop routing.
- Parent drops should not cross into an unrelated core family sibling line.
- `relationshipSegments` provenance must remain correct.

Current implementation status:

- Diagnostics now treat origin/core overlap as a routing/provenance issue, not as a raw bounds-overlap issue caused by the shared spouse node.
- Segment tests verify source-family parent drops stay attached to their own union ids, parent ids, and child ids.
- Core family segments are checked so they do not mix origin parents into their provenance.

## 4. Existing Solver Passes: Keep, Isolate, Replace Later

Short term, keep the existing layer assignment, initial coordinate assignment, and basic overlap repair behavior.

New group-aware logic should not be added as another late repair pass. Instead, later work should gradually replace person-level sibling spacing and subfamily spacing nudges with box-level spacing decisions.

Each replacement should be narrow and protected by fixtures and invariants before removing old behavior.

## 5. First Safe Implementation PR After This Plan

The next code PR should be:

```text
Add group-aware layout diagnostics without changing geometry
```

Suggested files:

```text
src/layout/layoutDiagnostics.ts
tests/layoutDiagnostics.test.ts
```

Suggested API:

```ts
diagnoseLayoutAgainstGroups(
  graph: PedigreeGraph,
  layout: LayoutResult,
  groupModel: RelationshipGroupModel
): LayoutDiagnostic[]
```

Diagnostics should report only:

- `dangling-group-reference`
- `semantic-view-missing-physical-link`
- `sibling-group-intrusion`
- `subfamily-space-collapsed`
- `origin-family-crosses-core-family`
- `node-overlap`
- `generation-order-violation`

The diagnostics PR must not change coordinates.

### Diagnostics-Only Implementation

`diagnoseLayoutAgainstGroups()` reports layout and group-model risks without fixing them.

- Diagnostics are not connected to the production layout pipeline.
- Diagnostics read `PedigreeGraph`, finalized `LayoutResult`, and `RelationshipGroupModel`; they do not mutate any input.
- Diagnostics derive group box bounds internally for group-level risk checks.
- The first goal is to make known-problem fixture risks structured and repeatable.
- Before any geometry-changing solver PR, diagnostics must remain deterministic.

## 6. Complex Known-Problem Family Unskip Criteria

The `complex-known-problem-family` layout test is active once these invariants are protected by tests and pass:

- Spouse-origin parent drops remain within their own origin/source union group.
- Spouse-origin parents are not mixed into the core family sibling line.
- Married-sibling subfamilies reserve independent horizontal space.
- Married-sibling spouse and child nodes are not mixed into the previous generation sibling group.
- No node overlap remains.
- Generation order remains valid.
- `relationshipSegments` provenance remains correct.
- SVG and browser renderers still consume finalized `LayoutResult` only.

Current status: active regression fixture.

## 7. Non-Goals

This plan does not:

- rewrite `coordinateSolver.ts`
- directly replace all post-processing passes
- solve all crossing or routing problems at once
- change the renderer
- change UI manual positioning
- handle the Chinese release directory
- split `app.js`
