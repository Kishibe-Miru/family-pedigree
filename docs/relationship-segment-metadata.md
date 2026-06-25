# Relationship Segment Metadata

`relationshipSegments` are the renderer-facing provenance record for pedigree lines. Metadata is for rendering, tests, and debugging only; it must not change node coordinates or relationship geometry.

## Kinds

- `marriage`: union line between two partners.
- `parent-drop`: vertical descent line from a parent union toward its children.
- `sibling-line`: horizontal sibling line for children of one union.
- `child-drop`: vertical line from a sibling line to one child.
- `twin`: child drop variant for twin branches.
- `twin-bar`: bar used for identical twin groups.
- `unknown`: fallback for compatibility.

The legacy `type` field is kept for compatibility with browser rendering. New tests should prefer `kind`.

## Provenance Fields

- `unionId`: owning union for the segment.
- `partnerIds`: partner ids for `marriage`.
- `parentIds`: parent or partner ids for `marriage` and `parent-drop`.
- `childIds`: all children for `parent-drop` and `sibling-line`, or the single child for `child-drop`.
- `personId`: child/person id for individual child drops.
- `source`: normalized provenance copy with `unionId`, `parentIds`, `childIds`, and `personIds` where available.

## Renderer Contract

Renderers may ignore metadata for drawing. The core SVG renderer emits non-visual debug attributes such as `data-kind`, `data-union-id`, and `data-person-id` so tests can verify provenance without re-deriving graph semantics.

## Known Problem Fixture

`complex-known-problem-family` is now an active regression fixture. Segment provenance must stay correct for spouse-origin parent drops, married-sibling subfamilies, sibling lines, and child drops.
