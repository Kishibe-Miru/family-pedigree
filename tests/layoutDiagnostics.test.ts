import test from "node:test";
import assert from "node:assert/strict";
import { layout } from "../src/browser/entry";
import {
  diagnoseLayoutAgainstGroups,
  LayoutDiagnostic
} from "../src/layout/layoutDiagnostics";
import { buildRelationshipGroups } from "../src/layout/relationshipGroups";
import { LayoutInput, LayoutResult } from "../src/model/layoutResult";
import { PedigreeGraph } from "../src/model/pedigreeGraph";
import {
  complexKnownProblemFamily,
  complexPedigreeFixtures,
  halfSiblingsThroughMultipleUnions,
  marriedSiblingWithOwnChild,
  simpleNuclearFamily
} from "./fixtures/complexPedigrees";

const STRUCTURAL_INVALID_KINDS = new Set([
  "constraint-reference-invalid",
  "semantic-view-missing-link"
]);

test("diagnostics run on all pedigree fixtures without structural invalid diagnostics", () => {
  for (const fixture of complexPedigreeFixtures) {
    const { diagnostics } = diagnoseFixture(fixture.input);

    assert.ok(Array.isArray(diagnostics), `${fixture.id} diagnostics should be an array`);
    assert.deepEqual(
      diagnostics.map((diagnostic) => diagnostic.id),
      [...diagnostics.map((diagnostic) => diagnostic.id)].sort(),
      `${fixture.id} diagnostic ids should be sorted`
    );
    assertNoStructuralInvalidDiagnostics(diagnostics, fixture.id);
  }
});

test("diagnostics are deterministic for complex and half-sibling fixtures", () => {
  for (const input of [complexKnownProblemFamily.input, halfSiblingsThroughMultipleUnions.input]) {
    const first = diagnoseFixture(input).diagnostics;
    const second = diagnoseFixture(input).diagnostics;

    assert.deepEqual(second, first);
  }
});

test("diagnostics detect artificial node overlap", () => {
  const { graph, layout, groupModel } = diagnoseFixture(simpleNuclearFamily.input);
  const overlapped = cloneLayout(layout);
  const a = overlapped.nodes.find((node) => node.id === "A");
  const b = overlapped.nodes.find((node) => node.id === "B");
  assert.ok(a);
  assert.ok(b);
  b.x = a.x;
  b.y = a.y;

  const diagnostics = diagnoseLayoutAgainstGroups(graph, overlapped, groupModel);
  const overlap = diagnostics.find((diagnostic) => diagnostic.kind === "node-overlap");

  assert.ok(overlap, "expected node-overlap diagnostic");
  assert.equal(overlap.severity, "error");
  assert.deepEqual(overlap.personIds, ["A", "B"]);
});

test("diagnostics detect artificial generation order violation", () => {
  const { graph, layout, groupModel } = diagnoseFixture(simpleNuclearFamily.input);
  const inverted = cloneLayout(layout);
  const parent = inverted.nodes.find((node) => node.id === "A");
  const child = inverted.nodes.find((node) => node.id === "C");
  assert.ok(parent);
  assert.ok(child);
  child.y = parent.y - 100;

  const diagnostics = diagnoseLayoutAgainstGroups(graph, inverted, groupModel);
  const violation = diagnostics.find((diagnostic) =>
    diagnostic.kind === "generation-order-violation" &&
    diagnostic.personIds?.includes("A") &&
    diagnostic.personIds?.includes("C")
  );

  assert.ok(violation, "expected generation-order-violation diagnostic");
  assert.equal(violation.severity, "error");
});

test("complex known-problem fixture is diagnostics-ready without structural invalid diagnostics", () => {
  const first = diagnoseFixture(complexKnownProblemFamily.input);
  const second = diagnoseFixture(complexKnownProblemFamily.input);

  assert.deepEqual(second.diagnostics, first.diagnostics);
  assertNoStructuralInvalidDiagnostics(first.diagnostics, complexKnownProblemFamily.id);
  assert.equal(
    first.diagnostics.some((diagnostic) => diagnostic.kind === "origin-family-crosses-core-family"),
    false
  );
  assert.ok(first.layout.nodes.length > 0, "complex fixture should produce nodes for diagnostics");
});

test("married sibling subfamily no longer reports collapsed source sibling space", () => {
  const { diagnostics } = diagnoseFixture(marriedSiblingWithOwnChild.input);

  assertNoStructuralInvalidDiagnostics(diagnostics, marriedSiblingWithOwnChild.id);
  assert.equal(
    diagnostics.some((diagnostic) => diagnostic.kind === "subfamily-space-collapsed"),
    false
  );
});

test("diagnostics do not mutate finalized layout", () => {
  for (const input of [simpleNuclearFamily.input, complexKnownProblemFamily.input]) {
    const { graph, layout, groupModel } = diagnoseFixture(input);
    const before = normalizeLayout(layout);

    diagnoseLayoutAgainstGroups(graph, layout, groupModel);

    assert.deepEqual(normalizeLayout(layout), before);
  }
});

function diagnoseFixture(input: LayoutInput) {
  const graph = graphFromInput(input);
  const layout = buildLayout(input);
  const groupModel = buildRelationshipGroups(graph);
  const diagnostics = diagnoseLayoutAgainstGroups(graph, layout, groupModel);

  return { graph, layout, groupModel, diagnostics };
}

function buildLayout(input: LayoutInput): LayoutResult {
  const response = layout(input);
  assert.ok(response.ok);
  return response.layout;
}

function graphFromInput(input: LayoutInput): PedigreeGraph {
  return {
    persons: new Map(input.persons.map((person) => [
      person.id,
      {
        id: person.id,
        sex: person.sex,
        birthOrder: person.birthOrder
      }
    ])),
    unions: new Map(input.unions.map((union) => [
      union.id,
      {
        id: union.id,
        partners: union.partners.length === 1
          ? [union.partners[0]]
          : [union.partners[0], union.partners[1]]
      }
    ])),
    childrenMap: new Map(input.childrenMap.map(([unionId, childIds]) => [unionId, [...childIds]]))
  };
}

function assertNoStructuralInvalidDiagnostics(diagnostics: LayoutDiagnostic[], fixtureId: string) {
  const invalid = diagnostics.filter((diagnostic) => STRUCTURAL_INVALID_KINDS.has(diagnostic.kind));
  assert.deepEqual(invalid, [], `${fixtureId} should not have structural invalid diagnostics`);
}

function cloneLayout(layout: LayoutResult): LayoutResult {
  return {
    nodes: layout.nodes.map((node) => ({ ...node })),
    positions: layout.positions.map((position) => ({ ...position })),
    relationshipSegments: layout.relationshipSegments.map((segment) => ({
      ...segment,
      partnerIds: segment.partnerIds ? [...segment.partnerIds] : undefined,
      parentIds: segment.parentIds ? [...segment.parentIds] : undefined,
      childIds: segment.childIds ? [...segment.childIds] : undefined,
      points: segment.points.map((point) => ({ ...point })),
      source: segment.source ? {
        unionId: segment.source.unionId,
        parentIds: segment.source.parentIds ? [...segment.source.parentIds] : undefined,
        childIds: segment.source.childIds ? [...segment.source.childIds] : undefined,
        personIds: segment.source.personIds ? [...segment.source.personIds] : undefined
      } : undefined
    })),
    unionAnchors: layout.unionAnchors.map((anchor) => ({
      ...anchor,
      partnerIds: [...anchor.partnerIds]
    })),
    bounds: { ...layout.bounds },
    generationLabels: layout.generationLabels.map((label) => ({ ...label }))
  };
}

function normalizeLayout(layout: LayoutResult) {
  return {
    nodes: layout.nodes.map((node) => ({
      id: node.id,
      x: node.x,
      y: node.y,
      generation: node.generation
    })),
    relationshipSegments: layout.relationshipSegments.map((segment) => ({
      id: segment.id,
      kind: segment.kind,
      unionId: segment.unionId,
      personId: segment.personId,
      from: segment.points[0],
      to: segment.points[segment.points.length - 1],
      source: segment.source ? {
        unionId: segment.source.unionId,
        parentIds: segment.source.parentIds,
        childIds: segment.source.childIds,
        personIds: segment.source.personIds
      } : undefined
    })),
    bounds: layout.bounds,
    generationLabels: layout.generationLabels
  };
}
