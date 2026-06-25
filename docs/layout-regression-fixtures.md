# Layout Regression Fixtures

These fixtures define semantic layout contracts before changing the complex layout solver. They are not pixel snapshots; tests assert relative geometry and relationship segment metadata.

## Active Fixtures

- `simple-nuclear-family`: A/B with child C. Protects marriage line, child vertical segment, and parent-before-child generation order.
- `multi-child-sibling-group`: A/B with C, D, E. Protects one sibling line per parent union.
- `married-sibling-with-own-child`: A/B with C, D; D/E with F. Protects that a married sibling remains in the source sibling group and that the subfamily stays non-overlapping.
- `spouse-with-origin-family`: A/B with C; P/Q with B. Protects separate union metadata for core and spouse-origin relationships.
- `half-siblings-through-multiple-unions`: A/B with C; A/D with E. Protects that different parent unions do not share one sibling line.
- `single-parent-union`: A with child C. Protects single-parent descent support.
- `three-generation-chain`: G1A/G1B -> G2A/G2B -> G3A. Protects generation y ordering across three generations.
- `complex-known-problem-family`: Core siblings, two spouse origin families, a married sibling subfamily, and one grandchild. Protects source-family parent drops, married-sibling subfamily spacing, segment provenance, generation order, and render metadata.

## Maintenance Rule

Before refactoring `src/layout/coordinateSolver.ts`, run these fixtures and update this document when a skipped known-problem fixture becomes active. Do not turn semantic layout failures into absolute-coordinate snapshots.
