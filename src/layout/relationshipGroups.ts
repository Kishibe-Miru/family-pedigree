import { PedigreeGraph } from "../model/pedigreeGraph";

export type RelationshipGroupKind =
  | "nuclear-family"
  | "origin-family"
  | "sibling-group"
  | "spouse-family"
  | "married-sibling-subfamily"
  | "married-sibling-union"
  | "spouse-union"
  | "single-parent-family";

export type LayoutBoxRole =
  | "person"
  | "union"
  | "sibling-group"
  | "family"
  | "subfamily";

export interface LayoutBox {
  id: string;
  role: LayoutBoxRole;
  personIds: string[];
  unionIds: string[];
  childIds: string[];
  parentIds: string[];
  source?: {
    unionId?: string;
    parentIds?: string[];
    childIds?: string[];
    personIds?: string[];
  };
}

export type RelationshipGroupPersonRole =
  | "parent"
  | "child"
  | "partner"
  | "spouse"
  | "sibling"
  | "subfamily-root"
  | "descendant";

export interface RelationshipGroupPersonRoleEntry {
  personId: string;
  role: RelationshipGroupPersonRole;
  unionId?: string;
}

export interface RelationshipGroup {
  id: string;
  kind: RelationshipGroupKind;
  unionId?: string;
  parentIds: string[];
  childIds: string[];
  personIds: string[];
  boxes: LayoutBox[];
  roles: RelationshipGroupPersonRoleEntry[];
  requiresDescendantSpace: boolean;
  isSemanticView?: boolean;
  linkedFamilyGroupId?: string;
  dependsOn?: string[];
}

export type LayoutConstraintKind =
  | "same-generation"
  | "parent-above-child"
  | "family-box-contained"
  | "sibling-group-separated"
  | "subfamily-reserves-space"
  | "origin-family-separated";

export interface LayoutConstraint {
  id: string;
  kind: LayoutConstraintKind;
  groupIds: string[];
  personIds: string[];
  unionIds: string[];
  reason: string;
}

export interface RelationshipGroupModel {
  groups: RelationshipGroup[];
  boxes: LayoutBox[];
  constraints: LayoutConstraint[];
}

export function buildRelationshipGroups(graph: PedigreeGraph): RelationshipGroupModel {
  const childToParentUnion = indexParentUnions(graph);
  const partnerToUnions = indexPartnerUnions(graph);
  const groups: RelationshipGroup[] = [];
  const constraints: LayoutConstraint[] = [];

  for (const union of sortedUnions(graph)) {
    const parentIds = [...union.partners];
    const childIds = [...(graph.childrenMap.get(union.id) ?? [])];

    const kind = familyKind(parentIds, childIds, childToParentUnion);
    const subfamilyRootIds = parentIds.filter((parentId) => childToParentUnion.has(parentId));
    const familyGroup = makeGroup(kind, `family:${union.id}`, union.id, parentIds, childIds, [], subfamilyRootIds);
    groups.push(familyGroup);
    constraints.push(...familyConstraints(familyGroup));

    if (childIds.length > 1) {
      const siblingGroup = makeGroup("sibling-group", `sibling:${union.id}`, union.id, parentIds, childIds, [familyGroup.id]);
      groups.push(siblingGroup);
      constraints.push({
        id: `family-box-contained:${siblingGroup.id}`,
        kind: "family-box-contained",
        groupIds: [familyGroup.id, siblingGroup.id],
        personIds: childIds,
        unionIds: [union.id],
        reason: "Sibling group belongs inside its parent union family box."
      });
    }
  }

  for (const [personId, originUnionId] of childToParentUnion.entries()) {
    const spouseUnionIds = (partnerToUnions.get(personId) ?? []).filter((unionId) => unionId !== originUnionId);
    if (spouseUnionIds.length === 0) continue;
    const originUnion = graph.unions.get(originUnionId);
    if (!originUnion) continue;
    const originChildIds = [...(graph.childrenMap.get(originUnionId) ?? [])];
    const originGroup = makeSemanticOriginGroup(
      "origin-family",
      `origin:${personId}:${originUnionId}`,
      originUnionId,
      [...originUnion.partners],
      originChildIds,
      `family:${originUnionId}`
    );
    groups.push(originGroup);

    for (const spouseUnionId of spouseUnionIds) {
      const spouseGroupId = `family:${spouseUnionId}`;
      constraints.push({
        id: `origin-family-separated:${originUnionId}:${spouseUnionId}:${personId}`,
        kind: "origin-family-separated",
        groupIds: [originGroup.id, spouseGroupId],
        personIds: [personId],
        unionIds: [originUnionId, spouseUnionId],
        reason: "A person's origin family and spouse/core family must remain separate layout groups."
      });
    }
  }

  const boxes = uniqueBoxes(groups.flatMap((group) => group.boxes));
  constraints.push(...halfSiblingSeparationConstraints(graph));

  return {
    groups: sortById(uniqueGroups(groups)),
    boxes: sortById(boxes),
    constraints: sortById(uniqueConstraints(constraints))
  };
}

function familyKind(
  parentIds: string[],
  childIds: string[],
  childToParentUnion: Map<string, string>
): RelationshipGroupKind {
  if (childIds.length === 0) {
    return parentIds.some((parentId) => childToParentUnion.has(parentId))
      ? "married-sibling-union"
      : "spouse-union";
  }
  if (parentIds.length === 1) return "single-parent-family";
  const marriedSibling = parentIds.some((parentId) => {
    const originUnionId = childToParentUnion.get(parentId);
    return originUnionId && (childIdsOf(originUnionId, childToParentUnion).length > 1);
  });
  if (marriedSibling) return "married-sibling-subfamily";
  if (parentIds.some((parentId) => childToParentUnion.has(parentId))) return "spouse-family";
  return "nuclear-family";
}

function makeGroup(
  kind: RelationshipGroupKind,
  id: string,
  unionId: string,
  parentIds: string[],
  childIds: string[],
  dependsOn: string[] = [],
  subfamilyRootIds: string[] = []
): RelationshipGroup {
  const personIds = unique([...parentIds, ...childIds]);
  const box: LayoutBox = {
    id: `box:${id}`,
    role: boxRoleForGroup(kind),
    personIds,
    unionIds: [unionId],
    childIds,
    parentIds,
    source: {
      unionId,
      parentIds,
      childIds,
      personIds
    }
  };

  return {
    id,
    kind,
    unionId,
    parentIds,
    childIds,
    personIds,
    boxes: [box],
    roles: rolesForGroup(kind, unionId, parentIds, childIds, subfamilyRootIds),
    requiresDescendantSpace: childIds.length > 0 && kind !== "spouse-union" && kind !== "married-sibling-union",
    ...(dependsOn.length ? { dependsOn } : {})
  };
}

function makeSemanticOriginGroup(
  kind: "origin-family",
  id: string,
  unionId: string,
  parentIds: string[],
  childIds: string[],
  linkedFamilyGroupId: string
): RelationshipGroup {
  return {
    id,
    kind,
    unionId,
    parentIds,
    childIds,
    personIds: unique([...parentIds, ...childIds]),
    boxes: [],
    roles: rolesForGroup(kind, unionId, parentIds, childIds),
    requiresDescendantSpace: false,
    isSemanticView: true,
    linkedFamilyGroupId
  };
}

function rolesForGroup(
  kind: RelationshipGroupKind,
  unionId: string,
  parentIds: string[],
  childIds: string[],
  subfamilyRootIds: string[] = []
): RelationshipGroupPersonRoleEntry[] {
  const roles: RelationshipGroupPersonRoleEntry[] = [];
  for (const parentId of parentIds) {
    roles.push({ personId: parentId, role: "partner", unionId });
    if (childIds.length > 0) roles.push({ personId: parentId, role: "parent", unionId });
    if (parentIds.length === 2) roles.push({ personId: parentId, role: "spouse", unionId });
    if ((kind === "married-sibling-subfamily" || kind === "married-sibling-union") && subfamilyRootIds.includes(parentId)) {
      roles.push({ personId: parentId, role: "subfamily-root", unionId });
    }
  }
  for (const childId of childIds) {
    roles.push({ personId: childId, role: "child", unionId });
    if (childIds.length > 1 || kind === "sibling-group") {
      roles.push({ personId: childId, role: "sibling", unionId });
    }
    if (kind === "married-sibling-subfamily") {
      roles.push({ personId: childId, role: "descendant", unionId });
    }
  }
  return roles.sort((a, b) =>
    a.personId.localeCompare(b.personId) ||
    a.role.localeCompare(b.role) ||
    (a.unionId ?? "").localeCompare(b.unionId ?? "")
  );
}

function familyConstraints(group: RelationshipGroup): LayoutConstraint[] {
  const constraints: LayoutConstraint[] = [];
  if (group.parentIds.length > 1) {
    constraints.push({
      id: `same-generation:${group.id}`,
      kind: "same-generation",
      groupIds: [group.id],
      personIds: group.parentIds,
      unionIds: group.unionId ? [group.unionId] : [],
      reason: "Partners in one union should be placed on the same generation."
    });
  }
  if (group.childIds.length > 0) {
    constraints.push({
      id: `parent-above-child:${group.id}`,
      kind: "parent-above-child",
      groupIds: [group.id],
      personIds: group.personIds,
      unionIds: group.unionId ? [group.unionId] : [],
      reason: "Parents should be placed above children in the family group."
    });
  }
  if (group.kind === "married-sibling-subfamily") {
    constraints.push({
      id: `subfamily-reserves-space:${group.id}`,
      kind: "subfamily-reserves-space",
      groupIds: [group.id],
      personIds: group.personIds,
      unionIds: group.unionId ? [group.unionId] : [],
      reason: "A married sibling subfamily should reserve independent layout space."
    });
  }
  return constraints;
}

function halfSiblingSeparationConstraints(graph: PedigreeGraph): LayoutConstraint[] {
  const constraints: LayoutConstraint[] = [];
  const unions = sortedUnions(graph);
  for (let i = 0; i < unions.length; i++) {
    for (let j = i + 1; j < unions.length; j++) {
      const left = unions[i];
      const right = unions[j];
      const sharedParents = left.partners.filter((parentId) => right.partners.includes(parentId));
      if (sharedParents.length === 0) continue;
      const leftChildren = graph.childrenMap.get(left.id) ?? [];
      const rightChildren = graph.childrenMap.get(right.id) ?? [];
      if (leftChildren.length === 0 || rightChildren.length === 0) continue;
      const [first, second] = [left, right].sort((a, b) => a.id.localeCompare(b.id));
      const firstChildren = graph.childrenMap.get(first.id) ?? [];
      const secondChildren = graph.childrenMap.get(second.id) ?? [];
      constraints.push({
        id: `sibling-group-separated:${first.id}:${second.id}`,
        kind: "sibling-group-separated",
        groupIds: [`family:${first.id}`, `family:${second.id}`],
        personIds: unique([...sharedParents.sort(), ...firstChildren, ...secondChildren]),
        unionIds: [first.id, second.id],
        reason: "Half siblings share a parent but belong to distinct union child groups."
      });
    }
  }
  return constraints;
}

function boxRoleForGroup(kind: RelationshipGroupKind): LayoutBoxRole {
  if (kind === "married-sibling-subfamily") return "subfamily";
  if (kind === "sibling-group") return "sibling-group";
  if (kind === "married-sibling-union" || kind === "spouse-union") return "union";
  return "family";
}

function indexParentUnions(graph: PedigreeGraph): Map<string, string> {
  const index = new Map<string, string>();
  for (const [unionId, childIds] of graph.childrenMap.entries()) {
    for (const childId of childIds) {
      index.set(childId, unionId);
    }
  }
  return index;
}

function indexPartnerUnions(graph: PedigreeGraph): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const union of graph.unions.values()) {
    for (const partnerId of union.partners) {
      if (!index.has(partnerId)) index.set(partnerId, []);
      index.get(partnerId)?.push(union.id);
    }
  }
  return index;
}

function childIdsOf(unionId: string, childToParentUnion: Map<string, string>): string[] {
  return [...childToParentUnion.entries()]
    .filter(([, parentUnionId]) => parentUnionId === unionId)
    .map(([childId]) => childId);
}

function uniqueBoxes(boxes: LayoutBox[]): LayoutBox[] {
  const byId = new Map<string, LayoutBox>();
  for (const box of boxes) byId.set(box.id, box);
  return [...byId.values()];
}

function uniqueGroups(groups: RelationshipGroup[]): RelationshipGroup[] {
  const byId = new Map<string, RelationshipGroup>();
  for (const group of groups) byId.set(group.id, group);
  return [...byId.values()];
}

function uniqueConstraints(constraints: LayoutConstraint[]): LayoutConstraint[] {
  const byId = new Map<string, LayoutConstraint>();
  for (const constraint of constraints) byId.set(constraint.id, constraint);
  return [...byId.values()];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function sortedUnions(graph: PedigreeGraph) {
  return [...graph.unions.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function sortById<T extends { id: string }>(values: T[]): T[] {
  return [...values].sort((a, b) => a.id.localeCompare(b.id));
}
