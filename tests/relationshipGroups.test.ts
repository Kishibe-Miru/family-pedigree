import test from "node:test";
import assert from "node:assert/strict";
import { buildRelationshipGroups } from "../src/layout/relationshipGroups";
import { LayoutInput } from "../src/model/layoutResult";
import { PedigreeGraph } from "../src/model/pedigreeGraph";
import {
  complexKnownProblemFamily,
  halfSiblingsThroughMultipleUnions,
  marriedSiblingWithOwnChild,
  multiChildSiblingGroup,
  simpleNuclearFamily,
  singleParentUnion,
  spouseWithOriginFamily
} from "./fixtures/complexPedigrees";
import {
  assertConstraintExists,
  assertGroupHasChildren,
  assertGroupHasParents,
  assertNoSiblingGroupContainsBoth,
  assertPersonDoesNotHaveRoleInGroup,
  assertPersonRoleInGroup,
  assertRelationshipGroupModelIsSelfConsistent,
  assertSiblingGroupForUnion,
  assertSubfamilyBoxContains,
  findBoxContainingPersons,
  findGroupByUnionId,
  findGroupsByKind
} from "./helpers/relationshipGroupAssertions";

test("simple nuclear family produces a family group", () => {
  const model = buildRelationshipGroups(graphFromInput(simpleNuclearFamily.input));
  const group = findGroupByUnionId(model, "uAB");

  assertRelationshipGroupModelIsSelfConsistent(model);
  assert.equal(group.kind, "nuclear-family");
  assert.equal(model.boxes.find((box) => box.id === "box:family:uAB")?.role, "family");
  assertGroupHasParents(group, ["A", "B"]);
  assertGroupHasChildren(group, ["C"]);
  assertPersonRoleInGroup(model, "A", group.id, "parent");
  assertPersonRoleInGroup(model, "B", group.id, "parent");
  assertConstraintExists(model, "same-generation", ["A", "B"]);
  assertConstraintExists(model, "parent-above-child", ["A", "B", "C"]);
});

test("multi-child sibling group produces one sibling group", () => {
  const model = buildRelationshipGroups(graphFromInput(multiChildSiblingGroup.input));
  const siblingGroups = findGroupsByKind(model, "sibling-group").filter((group) => group.unionId === "uAB");

  assertRelationshipGroupModelIsSelfConsistent(model);
  assert.equal(siblingGroups.length, 1);
  assertSiblingGroupForUnion(model, "uAB", ["C", "D", "E"]);
  assert.equal(model.boxes.find((box) => box.id === "box:sibling:uAB")?.role, "sibling-group");
});

test("half siblings produce separate sibling groups", () => {
  const model = buildRelationshipGroups(graphFromInput(halfSiblingsThroughMultipleUnions.input));
  const first = findGroupByUnionId(model, "uAB");
  const second = findGroupByUnionId(model, "uAD");

  assertRelationshipGroupModelIsSelfConsistent(model);
  assert.equal(first.kind, "nuclear-family");
  assert.equal(second.kind, "nuclear-family");
  assertGroupHasChildren(first, ["C"]);
  assertGroupHasChildren(second, ["E"]);
  assertNoSiblingGroupContainsBoth(model, "C", "E");
  assertConstraintExists(model, "sibling-group-separated", ["uAB", "uAD"]);
});

test("spouse origin family is separated from core family", () => {
  const model = buildRelationshipGroups(graphFromInput(spouseWithOriginFamily.input));
  const origin = findGroupsByKind(model, "origin-family").find((group) => group.unionId === "uPQ");
  const core = findGroupByUnionId(model, "uAB");

  assertRelationshipGroupModelIsSelfConsistent(model);
  assert.ok(origin);
  assert.equal(core.kind, "spouse-family");
  assert.notEqual(origin.unionId, core.unionId);
  assert.equal(origin.isSemanticView, true);
  assert.equal(origin.linkedFamilyGroupId, "family:uPQ");
  assert.equal(origin.boxes.length, 0);
  assertPersonRoleInGroup(model, "B", origin.id, "child");
  assertPersonRoleInGroup(model, "B", core.id, "partner");
  assertPersonRoleInGroup(model, "B", core.id, "spouse");
  assertPersonRoleInGroup(model, "B", core.id, "parent");
  assertConstraintExists(model, "origin-family-separated", [origin.id, core.id, "B"]);
});

test("married sibling has a subfamily box", () => {
  const model = buildRelationshipGroups(graphFromInput(marriedSiblingWithOwnChild.input));
  const sourceSibling = findGroupsByKind(model, "sibling-group").find((group) => group.unionId === "uAB");
  const subfamily = findGroupByUnionId(model, "uDE");

  assertRelationshipGroupModelIsSelfConsistent(model);
  assert.ok(sourceSibling);
  assert.equal(subfamily.kind, "married-sibling-subfamily");
  assert.equal(subfamily.requiresDescendantSpace, true);
  assertSiblingGroupForUnion(model, "uAB", ["C", "D"]);
  assertPersonRoleInGroup(model, "D", sourceSibling.id, "child");
  assertPersonRoleInGroup(model, "D", sourceSibling.id, "sibling");
  assertPersonRoleInGroup(model, "D", subfamily.id, "subfamily-root");
  assertPersonRoleInGroup(model, "D", subfamily.id, "parent");
  assertPersonDoesNotHaveRoleInGroup(model, "E", sourceSibling.id, "sibling");
  assertPersonDoesNotHaveRoleInGroup(model, "F", sourceSibling.id, "sibling");
  assertSubfamilyBoxContains(model, ["D", "E", "F"]);
  assertNoSiblingGroupContainsBoth(model, "C", "F");
  assert.equal(sourceSibling.childIds.includes("E"), false);
  assert.equal(sourceSibling.childIds.includes("F"), false);
  assertConstraintExists(model, "subfamily-reserves-space", ["D", "E", "F"]);
});

test("single parent family is represented", () => {
  const model = buildRelationshipGroups(graphFromInput(singleParentUnion.input));
  const group = findGroupByUnionId(model, "uA");

  assertRelationshipGroupModelIsSelfConsistent(model);
  assert.equal(group.kind, "single-parent-family");
  assert.equal(model.boxes.find((box) => box.id === "box:family:uA")?.role, "family");
  assertGroupHasParents(group, ["A"]);
  assertGroupHasChildren(group, ["C"]);
  assertPersonRoleInGroup(model, "A", group.id, "parent");
});

test("no-child married sibling union has explicit non-descendant-space semantics", () => {
  const model = buildRelationshipGroups(graphFromInput({
    persons: [
      { id: "A", sex: "M" },
      { id: "B", sex: "F" },
      { id: "C", sex: "U", birthOrder: 0 },
      { id: "D", sex: "U", birthOrder: 1 },
      { id: "E", sex: "U" }
    ],
    unions: [
      { id: "uAB", partners: ["A", "B"] },
      { id: "uDE", partners: ["D", "E"] }
    ],
    childrenMap: [
      ["uAB", ["C", "D"]],
      ["uDE", []]
    ]
  }));
  const sourceSibling = findGroupsByKind(model, "sibling-group").find((group) => group.unionId === "uAB");
  const spouseUnion = findGroupByUnionId(model, "uDE");

  assertRelationshipGroupModelIsSelfConsistent(model);
  assert.ok(sourceSibling);
  assert.equal(spouseUnion.kind, "married-sibling-union");
  assert.deepEqual(spouseUnion.childIds, []);
  assert.equal(spouseUnion.requiresDescendantSpace, false);
  assert.equal(model.boxes.find((box) => box.id === "box:family:uDE")?.role, "union");
  assertSiblingGroupForUnion(model, "uAB", ["C", "D"]);
  assertPersonRoleInGroup(model, "D", sourceSibling.id, "sibling");
  assertPersonRoleInGroup(model, "D", spouseUnion.id, "subfamily-root");
  assertPersonRoleInGroup(model, "D", spouseUnion.id, "partner");
  assertPersonRoleInGroup(model, "E", spouseUnion.id, "spouse");
  assertPersonDoesNotHaveRoleInGroup(model, "D", spouseUnion.id, "parent");
  assertPersonDoesNotHaveRoleInGroup(model, "E", spouseUnion.id, "parent");
  assertPersonDoesNotHaveRoleInGroup(model, "E", sourceSibling.id, "sibling");
  assertNoSiblingGroupContainsBoth(model, "C", "E");
});

test("spouse-union without children creates union box and no parent roles", () => {
  const model = buildRelationshipGroups(graphFromInput({
    persons: [
      { id: "A", sex: "U" },
      { id: "B", sex: "U" }
    ],
    unions: [
      { id: "uAB", partners: ["A", "B"] }
    ],
    childrenMap: [
      ["uAB", []]
    ]
  }));
  const spouseUnion = findGroupByUnionId(model, "uAB");

  assertRelationshipGroupModelIsSelfConsistent(model);
  assert.equal(spouseUnion.kind, "spouse-union");
  assert.equal(spouseUnion.requiresDescendantSpace, false);
  assert.equal(model.boxes.find((box) => box.id === "box:family:uAB")?.role, "union");
  assertPersonRoleInGroup(model, "A", spouseUnion.id, "partner");
  assertPersonRoleInGroup(model, "B", spouseUnion.id, "spouse");
  assertPersonDoesNotHaveRoleInGroup(model, "A", spouseUnion.id, "parent");
  assertPersonDoesNotHaveRoleInGroup(model, "B", spouseUnion.id, "parent");
});

test("complex known-problem family group model is analyzable", () => {
  const model = buildRelationshipGroups(graphFromInput(complexKnownProblemFamily.input));
  const coreFamily = findGroupByUnionId(model, "uA");
  const spouseOriginS1 = findGroupsByKind(model, "origin-family").find((group) => group.unionId === "uB");
  const spouseOriginS2 = findGroupsByKind(model, "origin-family").find((group) => group.unionId === "uC");
  const marriedSiblingSubfamily = findGroupByUnionId(model, "uK1S1");
  const noChildMarriedSiblingUnion = findGroupByUnionId(model, "uK2S2");
  const sourceSibling = findGroupsByKind(model, "sibling-group").find((group) => group.unionId === "uA");

  assertRelationshipGroupModelIsSelfConsistent(model);
  assert.ok(coreFamily);
  assert.equal(coreFamily.kind, "nuclear-family");
  assert.ok(spouseOriginS1);
  assert.ok(spouseOriginS2);
  assert.notEqual(spouseOriginS1.unionId, marriedSiblingSubfamily.unionId);
  assert.equal(spouseOriginS1.isSemanticView, true);
  assert.equal(spouseOriginS1.linkedFamilyGroupId, "family:uB");
  assert.equal(spouseOriginS2.isSemanticView, true);
  assert.equal(spouseOriginS2.linkedFamilyGroupId, "family:uC");
  assert.equal(marriedSiblingSubfamily.kind, "married-sibling-subfamily");
  assert.equal(marriedSiblingSubfamily.requiresDescendantSpace, true);
  assert.equal(model.boxes.find((box) => box.id === "box:family:uK1S1")?.role, "subfamily");
  assert.equal(noChildMarriedSiblingUnion.kind, "married-sibling-union");
  assert.equal(noChildMarriedSiblingUnion.requiresDescendantSpace, false);
  assert.equal(model.boxes.find((box) => box.id === "box:family:uK2S2")?.role, "union");
  assert.ok(sourceSibling);
  assertSiblingGroupForUnion(model, "uA", ["K1", "K2"]);
  assertPersonRoleInGroup(model, "K1", sourceSibling.id, "sibling");
  assertPersonRoleInGroup(model, "K1", marriedSiblingSubfamily.id, "subfamily-root");
  assertPersonRoleInGroup(model, "S1", spouseOriginS1.id, "child");
  assertPersonRoleInGroup(model, "S1", marriedSiblingSubfamily.id, "spouse");
  assertPersonDoesNotHaveRoleInGroup(model, "S1", sourceSibling.id, "sibling");
  assertPersonDoesNotHaveRoleInGroup(model, "G1", sourceSibling.id, "sibling");
  assertPersonDoesNotHaveRoleInGroup(model, "B1", coreFamily.id, "parent");
  assertPersonDoesNotHaveRoleInGroup(model, "C1", coreFamily.id, "parent");
  assertSubfamilyBoxContains(model, ["K1", "S1", "G1"]);
  assert.ok(findBoxContainingPersons(model, ["K1", "K2"]));
  assertConstraintExists(model, "origin-family-separated", ["uB", "uK1S1", "S1"]);
  assertConstraintExists(model, "origin-family-separated", ["uC", "uK2S2", "S2"]);
  assertConstraintExists(model, "subfamily-reserves-space", ["K1", "S1", "G1"]);
});

test("half siblings group model stays stable when union and childrenMap insertion order is reversed", () => {
  const normal = normalizeGroupModel(buildRelationshipGroups(graphFromInput(halfSiblingsThroughMultipleUnions.input)));
  const reversed = normalizeGroupModel(buildRelationshipGroups(graphFromInput(halfSiblingsThroughMultipleUnions.input, {
    reverseTopLevelOrder: true
  })));

  assert.deepEqual(reversed, normal);
  assert.ok(normal.constraints.some((constraint) =>
    constraint.id === "sibling-group-separated:uAB:uAD" &&
    constraint.groupIds.join(",") === "family:uAB,family:uAD" &&
    constraint.unionIds.join(",") === "uAB,uAD"
  ));
});

test("same graph produces stable relationship group model", () => {
  const normal = normalizeGroupModel(buildRelationshipGroups(graphFromInput(complexKnownProblemFamily.input)));
  const repeated = normalizeGroupModel(buildRelationshipGroups(graphFromInput(complexKnownProblemFamily.input)));
  const reversedTopLevel = normalizeGroupModel(buildRelationshipGroups(graphFromInput(complexKnownProblemFamily.input, {
    reverseTopLevelOrder: true
  })));

  assert.deepEqual(repeated, normal);
  assert.deepEqual(reversedTopLevel, normal);
});

function graphFromInput(input: LayoutInput, options: { reverseTopLevelOrder?: boolean } = {}): PedigreeGraph {
  const persons = options.reverseTopLevelOrder ? [...input.persons].reverse() : input.persons;
  const unions = options.reverseTopLevelOrder ? [...input.unions].reverse() : input.unions;
  const childrenMap = options.reverseTopLevelOrder ? [...input.childrenMap].reverse() : input.childrenMap;

  return {
    persons: new Map(persons.map((person) => [
      person.id,
      {
        id: person.id,
        sex: person.sex,
        birthOrder: person.birthOrder
      }
    ])),
    unions: new Map(unions.map((union) => [
      union.id,
      {
        id: union.id,
        partners: union.partners.length === 1
          ? [union.partners[0]]
          : [union.partners[0], union.partners[1]]
      }
    ])),
    childrenMap: new Map(childrenMap.map(([unionId, childIds]) => [unionId, [...childIds]]))
  };
}

function normalizeGroupModel(model: ReturnType<typeof buildRelationshipGroups>) {
  return {
    groups: model.groups.map((group) => ({
      id: group.id,
      kind: group.kind,
      unionId: group.unionId,
      parentIds: [...group.parentIds],
      childIds: [...group.childIds],
      personIds: [...group.personIds],
      roles: group.roles.map((role) => ({ ...role })),
      requiresDescendantSpace: group.requiresDescendantSpace,
      isSemanticView: group.isSemanticView,
      linkedFamilyGroupId: group.linkedFamilyGroupId,
      dependsOn: group.dependsOn ? [...group.dependsOn] : undefined
    })),
    boxes: model.boxes.map((box) => ({
      id: box.id,
      role: box.role,
      personIds: [...box.personIds],
      unionIds: [...box.unionIds],
      childIds: [...box.childIds],
      parentIds: [...box.parentIds],
      source: box.source ? {
        unionId: box.source.unionId,
        parentIds: box.source.parentIds ? [...box.source.parentIds] : undefined,
        childIds: box.source.childIds ? [...box.source.childIds] : undefined,
        personIds: box.source.personIds ? [...box.source.personIds] : undefined
      } : undefined
    })),
    constraints: model.constraints.map((constraint) => ({
      id: constraint.id,
      kind: constraint.kind,
      groupIds: [...constraint.groupIds],
      personIds: [...constraint.personIds],
      unionIds: [...constraint.unionIds],
      reason: constraint.reason
    }))
  };
}
