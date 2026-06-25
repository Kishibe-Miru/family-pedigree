# Relationship Group Layout Boxes

Relationship groups are a semantic model for future layout solving. They do not contain coordinates and they are not consumed by the current `computeLayout()` pipeline.

See [`coordinate-solver-group-integration-plan.md`](coordinate-solver-group-integration-plan.md) for the phased plan to consume this model in the solver.
The diagnostics-only entry point is `diagnoseLayoutAgainstGroups()` in `src/layout/layoutDiagnostics.ts`.
Derived box bounds are available through `deriveGroupBoxBounds()` in `src/layout/groupBoxBounds.ts`; they are computed from finalized `LayoutResult` nodes and do not affect solver output.
`diagnoseLayoutAgainstGroups()` consumes those derived bounds for group-level warnings while still leaving geometry unchanged.

## Why This Exists

Complex pedigrees need stable concepts before adding more coordinate repair passes. The group model names the family units, sibling groups, origin families, and subfamilies that a future solver should reserve space for.

## Group Kinds

- `nuclear-family`: two-parent union with children.
- `single-parent-family`: one-parent union with children.
- `sibling-group`: multiple children from the same union.
- `spouse-family`: a family where at least one partner also has an origin family.
- `origin-family`: a semantic view of the family a partner comes from when that person is also a child in another union.
- `married-sibling-subfamily`: a child from one sibling group who forms a new family with a spouse and child.
- `married-sibling-union`: a child from one sibling group who forms a spouse union without children.
- `spouse-union`: a spouse union without children where neither partner is currently modeled as a sibling subfamily root.

`married-sibling-subfamily` and `married-sibling-union` are intentionally distinct. A subfamily has children and `requiresDescendantSpace: true`; a no-child union has `requiresDescendantSpace: false` and must not reserve descendant layout space.

No-child spouse unions use `LayoutBox.role = "union"` rather than `"family"`. Their partners receive `partner` and, for two-person unions, `spouse` roles, but they do not receive `parent` roles until the union has children.

## Person Roles

Each relationship group records role metadata:

- `parent`
- `child`
- `partner`
- `spouse`
- `sibling`
- `subfamily-root`
- `descendant`

The same person can have different roles in different groups. For example, a person can be `child` in an `origin-family`, `sibling` in their source sibling group, and `partner` or `spouse` in their own spouse union. These roles are diagnostics and future solver inputs only; the current renderer and coordinate solver do not consume them.

## Semantic Origin Families

`origin-family` is a semantic view, not a duplicate physical family box. It sets:

- `isSemanticView: true`
- `linkedFamilyGroupId: "family:<source-union-id>"`
- `boxes: []`

This lets a future solver understand that `origin:<personId>:<unionId>` and `family:<unionId>` describe the same physical family structure from different semantic perspectives.

## Layout Boxes

`LayoutBox` is a future solver unit. A box records person ids, union ids, parent ids, child ids, and source metadata. It is not a final bounding rectangle and it should not affect current layout geometry.

## Constraints

Constraints are currently design/test artifacts only:

- `same-generation`
- `parent-above-child`
- `family-box-contained`
- `sibling-group-separated`
- `subfamily-reserves-space`
- `origin-family-separated`

They are intended to guide a later `coordinateSolver.ts` refactor. That refactor should consume relationship groups instead of adding more repair, nudge, or special-case passes.

Half-sibling separation constraints use canonical union id ordering for `id`, `groupIds`, and `unionIds`, so equivalent graph inputs do not depend on `Map` insertion order.

## Known Problem Fixture

`complex-known-problem-family` is now an active layout regression fixture. The group model expresses its core issue: core family, spouse-origin family groups, married-sibling subfamily boxes, origin-family separation constraints, and subfamily-reserves-space constraints.

## Before CoordinateSolver Integration

Before relationship groups are consumed by `coordinateSolver.ts`, the model must keep these invariants:

1. `group.id`, `box.id`, and `constraint.id` are stable and unique.
2. Every `constraint.groupIds` entry references an existing group.
3. Person role metadata is explicit enough to distinguish origin, sibling, spouse, and descendant roles.
4. `origin-family` remains linked to the source physical `family:*` group instead of allocating a duplicate physical box.
5. `married-sibling-union` and `married-sibling-subfamily` stay distinct so no-child spouse unions do not reserve descendant space.
6. Constraints describe semantic relationships only; they do not participate in the current layout pipeline.
7. The group model does not change current node coordinates or relationship segment geometry.
8. `complex-known-problem-family` layout coverage remains active and must keep these invariants passing.
