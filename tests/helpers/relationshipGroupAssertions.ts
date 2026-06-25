import assert from "node:assert/strict";
import {
  LayoutConstraintKind,
  RelationshipGroup,
  RelationshipGroupKind,
  RelationshipGroupPersonRole,
  RelationshipGroupModel
} from "../../src/layout/relationshipGroups";

export function findGroupByUnionId(model: RelationshipGroupModel, unionId: string): RelationshipGroup {
  const group = model.groups.find((candidate) => candidate.unionId === unionId && candidate.id === `family:${unionId}`);
  assert.ok(group, `missing family group for union ${unionId}`);
  return group;
}

export function findGroupsByKind(model: RelationshipGroupModel, kind: RelationshipGroupKind): RelationshipGroup[] {
  return model.groups.filter((group) => group.kind === kind);
}

export function findBoxContainingPersons(model: RelationshipGroupModel, personIds: string[]) {
  const box = model.boxes.find((candidate) =>
    personIds.every((personId) => candidate.personIds.includes(personId))
  );
  assert.ok(box, `missing box containing persons ${personIds.join(", ")}`);
  return box;
}

export function assertGroupHasParents(group: RelationshipGroup, parentIds: string[]) {
  assert.deepEqual([...group.parentIds].sort(), [...parentIds].sort(), `${group.id} parentIds`);
}

export function assertGroupHasChildren(group: RelationshipGroup, childIds: string[]) {
  assert.deepEqual([...group.childIds].sort(), [...childIds].sort(), `${group.id} childIds`);
}

export function assertSiblingGroupForUnion(model: RelationshipGroupModel, unionId: string, childIds: string[]) {
  const group = model.groups.find((candidate) =>
    candidate.kind === "sibling-group" && candidate.unionId === unionId
  );
  assert.ok(group, `missing sibling group for union ${unionId}`);
  assertGroupHasChildren(group, childIds);
}

export function assertNoSiblingGroupContainsBoth(model: RelationshipGroupModel, childA: string, childB: string) {
  const mixed = model.groups.find((group) =>
    group.kind === "sibling-group" &&
    group.childIds.includes(childA) &&
    group.childIds.includes(childB)
  );
  assert.equal(mixed, undefined, `expected no sibling group to contain both ${childA} and ${childB}`);
}

export function assertPersonRoleInGroup(
  model: RelationshipGroupModel,
  personId: string,
  groupId: string,
  role: RelationshipGroupPersonRole | "person"
) {
  const group = model.groups.find((candidate) => candidate.id === groupId);
  assert.ok(group, `missing group ${groupId}`);
  if (role === "person") {
    assert.ok(group.personIds.includes(personId), `expected ${personId} to appear in ${groupId}`);
    return;
  }
  assert.ok(
    group.roles.some((entry) => entry.personId === personId && entry.role === role),
    `expected ${personId} to have role ${role} in ${groupId}`
  );
}

export function assertPersonDoesNotHaveRoleInGroup(
  model: RelationshipGroupModel,
  personId: string,
  groupId: string,
  role: RelationshipGroupPersonRole
) {
  const group = model.groups.find((candidate) => candidate.id === groupId);
  assert.ok(group, `missing group ${groupId}`);
  assert.equal(
    group.roles.some((entry) => entry.personId === personId && entry.role === role),
    false,
    `expected ${personId} not to have role ${role} in ${groupId}`
  );
}

export function assertSubfamilyBoxContains(model: RelationshipGroupModel, personIds: string[]) {
  const box = model.boxes.find((candidate) =>
    candidate.role === "subfamily" &&
    personIds.every((personId) => candidate.personIds.includes(personId))
  );
  assert.ok(box, `missing subfamily box containing ${personIds.join(", ")}`);
}

export function assertConstraintExists(
  model: RelationshipGroupModel,
  kind: LayoutConstraintKind,
  ids: string[]
) {
  const constraint = model.constraints.find((candidate) =>
    candidate.kind === kind &&
    ids.every((id) =>
      candidate.groupIds.includes(id) ||
      candidate.personIds.includes(id) ||
      candidate.unionIds.includes(id)
    )
  );
  assert.ok(constraint, `missing ${kind} constraint for ${ids.join(", ")}`);
}

export function assertNoDanglingGroupRefs(model: RelationshipGroupModel) {
  assertEveryConstraintReferencesExistingGroups(model);
  const groupIds = new Set(model.groups.map((group) => group.id));
  for (const group of model.groups) {
    for (const dependsOn of group.dependsOn ?? []) {
      assert.ok(groupIds.has(dependsOn), `group ${group.id} depends on missing group ${dependsOn}`);
    }
    if (group.linkedFamilyGroupId) {
      assert.ok(groupIds.has(group.linkedFamilyGroupId), `group ${group.id} links missing group ${group.linkedFamilyGroupId}`);
    }
  }
}

export function assertEveryConstraintReferencesExistingGroups(model: RelationshipGroupModel) {
  const groupIds = new Set(model.groups.map((group) => group.id));
  for (const constraint of model.constraints) {
    for (const groupId of constraint.groupIds) {
      assert.ok(groupIds.has(groupId), `constraint ${constraint.id} references missing group ${groupId}`);
    }
  }
}

export function assertEveryBoxHasValidSource(model: RelationshipGroupModel) {
  for (const box of model.boxes) {
    assertNoEmpty(box.personIds, `box ${box.id} personIds`);
    assertNoEmpty(box.unionIds, `box ${box.id} unionIds`);
    assertNoEmpty(box.childIds, `box ${box.id} childIds`);
    assertNoEmpty(box.parentIds, `box ${box.id} parentIds`);
    if (box.source) {
      assertNoEmpty(box.source.unionId ? [box.source.unionId] : [], `box ${box.id} source.unionId`);
      assertNoEmpty(box.source.parentIds ?? [], `box ${box.id} source.parentIds`);
      assertNoEmpty(box.source.childIds ?? [], `box ${box.id} source.childIds`);
      assertNoEmpty(box.source.personIds ?? [], `box ${box.id} source.personIds`);
    }
  }
}

export function assertNoDuplicateGroupIds(model: RelationshipGroupModel) {
  assertNoDuplicate(model.groups.map((group) => group.id), "group id");
}

export function assertNoDuplicateBoxIds(model: RelationshipGroupModel) {
  assertNoDuplicate(model.boxes.map((box) => box.id), "box id");
}

export function assertNoDuplicateConstraintIds(model: RelationshipGroupModel) {
  assertNoDuplicate(model.constraints.map((constraint) => constraint.id), "constraint id");
}

export function assertRelationshipGroupModelIsSelfConsistent(model: RelationshipGroupModel) {
  assertNoDuplicateGroupIds(model);
  assertNoDuplicateBoxIds(model);
  assertNoDuplicateConstraintIds(model);
  assertNoDanglingGroupRefs(model);
  assertEveryBoxHasValidSource(model);

  for (const group of model.groups) {
    assertNoEmpty(group.parentIds, `group ${group.id} parentIds`);
    assertNoEmpty(group.childIds, `group ${group.id} childIds`);
    assertNoEmpty(group.personIds, `group ${group.id} personIds`);
    for (const role of group.roles) {
      assertNoEmpty([role.personId], `group ${group.id} role personId`);
      assertNoEmpty(role.unionId ? [role.unionId] : [], `group ${group.id} role unionId`);
      assert.ok(group.personIds.includes(role.personId), `group ${group.id} role references person outside personIds`);
    }
  }

  for (const constraint of model.constraints) {
    assertNoEmpty(constraint.unionIds, `constraint ${constraint.id} unionIds`);
    assertNoEmpty(constraint.personIds, `constraint ${constraint.id} personIds`);
  }
}

function assertNoDuplicate(values: string[], label: string) {
  assert.equal(new Set(values).size, values.length, `duplicate ${label}`);
}

function assertNoEmpty(values: string[], label: string) {
  for (const value of values) {
    assert.notEqual(value, "", `${label} contains empty string`);
  }
}
