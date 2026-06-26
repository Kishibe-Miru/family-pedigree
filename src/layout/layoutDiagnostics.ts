import { NODE_SIZE } from "./boxModel";
import {
  boundsOverlap,
  deriveGroupBoxBounds,
  findGroupBoxBounds,
  GroupBoxBounds,
  GroupBoxBoundsModel
} from "./groupBoxBounds";
import { LayoutResult } from "../model/layoutResult";
import { PedigreeGraph } from "../model/pedigreeGraph";
import {
  LayoutConstraint,
  RelationshipGroup,
  RelationshipGroupModel
} from "./relationshipGroups";

export type LayoutDiagnosticSeverity = "info" | "warning" | "error";

export type LayoutDiagnosticKind =
  | "node-overlap"
  | "generation-order-violation"
  | "dangling-group-reference"
  | "semantic-view-missing-link"
  | "sibling-group-intrusion"
  | "subfamily-space-collapsed"
  | "origin-family-crosses-core-family"
  | "constraint-reference-invalid";

export type LayoutDiagnostic = {
  id: string;
  kind: LayoutDiagnosticKind;
  severity: LayoutDiagnosticSeverity;
  message: string;
  groupIds?: string[];
  boxIds?: string[];
  unionIds?: string[];
  personIds?: string[];
  segmentIds?: string[];
};

const NODE_OVERLAP_TOLERANCE = 1;
const GENERATION_Y_TOLERANCE = 1;

export function diagnoseLayoutAgainstGroups(
  graph: PedigreeGraph,
  layout: LayoutResult,
  groupModel: RelationshipGroupModel
): LayoutDiagnostic[] {
  const boundsModel = deriveGroupBoxBounds(layout, groupModel);
  const diagnostics = [
    ...diagnoseConstraintReferences(groupModel),
    ...diagnoseSemanticViews(groupModel),
    ...diagnoseNodeOverlaps(layout),
    ...diagnoseGenerationOrder(graph, layout),
    ...diagnoseSiblingGroups(graph, groupModel),
    ...diagnoseSubfamilySpace(graph, layout, groupModel, boundsModel),
    ...diagnoseOriginFamilySeparation(layout, groupModel, boundsModel)
  ];

  return diagnostics.map(normalizeDiagnostic).sort(compareDiagnostic);
}

function diagnoseConstraintReferences(groupModel: RelationshipGroupModel): LayoutDiagnostic[] {
  const diagnostics: LayoutDiagnostic[] = [];
  const groupIds = new Set(groupModel.groups.map((group) => group.id));
  for (const constraint of groupModel.constraints) {
    for (const groupId of constraint.groupIds) {
      if (groupIds.has(groupId)) continue;
      diagnostics.push({
        id: `constraint-reference-invalid:${constraint.id}:${groupId}`,
        kind: "constraint-reference-invalid",
        severity: "error",
        message: `Constraint ${constraint.id} references missing group ${groupId}.`,
        groupIds: [groupId],
        unionIds: constraint.unionIds,
        personIds: constraint.personIds
      });
    }
  }
  return diagnostics;
}

function diagnoseSemanticViews(groupModel: RelationshipGroupModel): LayoutDiagnostic[] {
  const diagnostics: LayoutDiagnostic[] = [];
  const groupIds = new Set(groupModel.groups.map((group) => group.id));
  for (const group of groupModel.groups) {
    if (!group.isSemanticView) continue;
    if (!group.linkedFamilyGroupId) {
      diagnostics.push({
        id: `semantic-view-missing-link:${group.id}:missing-link`,
        kind: "semantic-view-missing-link",
        severity: "error",
        message: `Semantic group ${group.id} is missing linkedFamilyGroupId.`,
        groupIds: [group.id],
        unionIds: group.unionId ? [group.unionId] : [],
        personIds: group.personIds
      });
      continue;
    }
    if (!groupIds.has(group.linkedFamilyGroupId)) {
      diagnostics.push({
        id: `semantic-view-missing-link:${group.id}:missing-target`,
        kind: "semantic-view-missing-link",
        severity: "error",
        message: `Semantic group ${group.id} links to missing group ${group.linkedFamilyGroupId}.`,
        groupIds: [group.id, group.linkedFamilyGroupId],
        unionIds: group.unionId ? [group.unionId] : [],
        personIds: group.personIds
      });
    }
    if (group.boxes.length > 0) {
      diagnostics.push({
        id: `semantic-view-missing-link:${group.id}:physical-box`,
        kind: "semantic-view-missing-link",
        severity: "warning",
        message: `Semantic group ${group.id} should not allocate physical boxes.`,
        groupIds: [group.id],
        boxIds: group.boxes.map((box) => box.id),
        unionIds: group.unionId ? [group.unionId] : [],
        personIds: group.personIds
      });
    }
  }
  return diagnostics;
}

function diagnoseNodeOverlaps(layout: LayoutResult): LayoutDiagnostic[] {
  const diagnostics: LayoutDiagnostic[] = [];
  const nodes = [...layout.nodes].sort((a, b) => a.id.localeCompare(b.id));
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      if (
        Math.abs(a.x - b.x) >= NODE_SIZE - NODE_OVERLAP_TOLERANCE ||
        Math.abs(a.y - b.y) >= NODE_SIZE - NODE_OVERLAP_TOLERANCE
      ) {
        continue;
      }
      diagnostics.push({
        id: `node-overlap:${a.id}:${b.id}`,
        kind: "node-overlap",
        severity: "error",
        message: `Nodes ${a.id} and ${b.id} overlap or are too close.`,
        personIds: [a.id, b.id]
      });
    }
  }
  return diagnostics;
}

function diagnoseGenerationOrder(graph: PedigreeGraph, layout: LayoutResult): LayoutDiagnostic[] {
  const diagnostics: LayoutDiagnostic[] = [];
  const nodeById = new Map(layout.nodes.map((node) => [node.id, node]));
  for (const [unionId, childIds] of sortedChildrenMap(graph)) {
    const union = graph.unions.get(unionId);
    if (!union) continue;
    for (const parentId of [...union.partners].sort()) {
      const parent = nodeById.get(parentId);
      if (!parent) continue;
      for (const childId of [...childIds].sort()) {
        const child = nodeById.get(childId);
        if (!child) continue;
        if (parent.y < child.y - GENERATION_Y_TOLERANCE) continue;
        diagnostics.push({
          id: `generation-order-violation:${unionId}:${parentId}:${childId}`,
          kind: "generation-order-violation",
          severity: "error",
          message: `Parent ${parentId} is not above child ${childId} for union ${unionId}.`,
          unionIds: [unionId],
          personIds: [parentId, childId]
        });
      }
    }
  }
  return diagnostics;
}

function diagnoseSiblingGroups(graph: PedigreeGraph, groupModel: RelationshipGroupModel): LayoutDiagnostic[] {
  const diagnostics: LayoutDiagnostic[] = [];
  for (const group of groupModel.groups) {
    if (group.kind !== "sibling-group" || !group.unionId) continue;
    const expected = [...(graph.childrenMap.get(group.unionId) ?? [])].sort();
    const actual = [...group.childIds].sort();
    if (sameValues(expected, actual)) continue;
    diagnostics.push({
      id: `sibling-group-intrusion:${group.id}`,
      kind: "sibling-group-intrusion",
      severity: "error",
      message: `Sibling group ${group.id} does not match children for union ${group.unionId}.`,
      groupIds: [group.id],
      unionIds: [group.unionId],
      personIds: unique([...expected, ...actual])
    });
  }
  return diagnostics;
}

function diagnoseSubfamilySpace(
  graph: PedigreeGraph,
  layout: LayoutResult,
  groupModel: RelationshipGroupModel,
  boundsModel: GroupBoxBoundsModel
): LayoutDiagnostic[] {
  const diagnostics: LayoutDiagnostic[] = [];
  const nodeById = new Map(layout.nodes.map((node) => [node.id, node]));

  for (const group of groupModel.groups) {
    if (group.kind !== "married-sibling-subfamily" && !group.requiresDescendantSpace) continue;
    if (unionUsesLoweredMarriageRoute(layout, group.unionId)) continue;
    const subfamilyBounds = findGroupBoxBounds(boundsModel, group.id);
    if (!subfamilyBounds) continue;
    const rootIds = group.roles
      .filter((role) => role.role === "subfamily-root")
      .map((role) => role.personId)
      .sort();
    for (const rootId of rootIds) {
      const originUnionId = parentUnionForPerson(graph, rootId);
      if (!originUnionId) continue;
      const originSiblings = (graph.childrenMap.get(originUnionId) ?? [])
        .filter((personId) => personId !== rootId)
        .sort();
      const siblingBounds = findGroupBoxBounds(boundsModel, `sibling:${originUnionId}`);
      if (!siblingBounds) continue;
      for (const siblingId of originSiblings) {
        const sibling = nodeById.get(siblingId);
        if (!sibling) continue;
        const siblingPointBounds = nodeBounds(siblingId, sibling.x, sibling.y);
        if (!siblingPointBounds || !boundsOverlap(subfamilyBounds, siblingPointBounds)) continue;
        diagnostics.push({
          id: `subfamily-space-collapsed:${group.id}:${siblingId}`,
          kind: "subfamily-space-collapsed",
          severity: "warning",
          message: `Subfamily ${group.id} overlaps source sibling ${siblingId}.`,
          groupIds: [group.id, `sibling:${originUnionId}`],
          boxIds: unique([subfamilyBounds.boxId, siblingBounds.boxId].filter(isString)),
          unionIds: unique([group.unionId, originUnionId].filter(isString)),
          personIds: unique([siblingId, ...group.personIds])
        });
      }
    }
  }

  return diagnostics;
}

function unionUsesLoweredMarriageRoute(layout: LayoutResult, unionId?: string) {
  if (!unionId) return false;
  return layout.relationshipSegments.some((segment) =>
    segment.unionId === unionId &&
    segment.kind === "marriage" &&
    segment.points.length > 2
  );
}

function diagnoseOriginFamilySeparation(
  layout: LayoutResult,
  groupModel: RelationshipGroupModel,
  boundsModel: GroupBoxBoundsModel
): LayoutDiagnostic[] {
  const diagnostics: LayoutDiagnostic[] = [];
  const groupById = new Map(groupModel.groups.map((group) => [group.id, group]));
  for (const constraint of groupModel.constraints) {
    if (constraint.kind !== "origin-family-separated") continue;
    const [originGroupId, coreGroupId] = constraint.groupIds;
    const originGroup = groupById.get(originGroupId);
    const coreGroup = groupById.get(coreGroupId);
    if (!originGroup || !coreGroup) continue;
    if (originGroup.linkedFamilyGroupId === coreGroup.id) {
      diagnostics.push(originDiagnostic(
        constraint,
        "error",
        `Origin family ${originGroup.id} links to the same physical group as core group ${coreGroup.id}.`,
        boundsModel
      ));
    }
    for (const personId of constraint.personIds) {
      const isOriginChild = hasRole(originGroup, personId, "child");
      const isCorePartner = hasRole(coreGroup, personId, "partner") || hasRole(coreGroup, personId, "spouse");
      if (isOriginChild && isCorePartner) continue;
      diagnostics.push(originDiagnostic(
        constraint,
        "warning",
        `Person ${personId} does not have expected origin child and core partner roles.`,
        boundsModel
      ));
    }
    diagnostics.push(...diagnoseOriginParentDropRouting(layout, constraint, originGroup, coreGroup, boundsModel));
  }
  return diagnostics;
}

function diagnoseOriginParentDropRouting(
  layout: LayoutResult,
  constraint: LayoutConstraint,
  originGroup: RelationshipGroup,
  coreGroup: RelationshipGroup,
  boundsModel: GroupBoxBoundsModel
): LayoutDiagnostic[] {
  const diagnostics: LayoutDiagnostic[] = [];
  const originUnionId = originGroup.unionId;
  const coreUnionId = coreGroup.unionId;
  if (!originUnionId || !coreUnionId) return diagnostics;

  const originParentDrop = layout.relationshipSegments.find((segment) =>
    segment.kind === "parent-drop" && segment.unionId === originUnionId
  );
  const originChildId = constraint.personIds[0];
  if (!originParentDrop) {
    diagnostics.push(originDiagnostic(
      constraint,
      "warning",
      `Origin union ${originUnionId} is missing its parent-drop segment.`,
      boundsModel
    ));
    return diagnostics;
  }
  if (!originParentDrop.childIds?.includes(originChildId)) {
    diagnostics.push(originDiagnostic(
      constraint,
      "warning",
      `Origin parent-drop ${originParentDrop.id} does not target child ${originChildId}.`,
      boundsModel,
      [originParentDrop.id]
    ));
  }
  if (!sameMembers(originParentDrop.parentIds ?? [], originGroup.parentIds)) {
    diagnostics.push(originDiagnostic(
      constraint,
      "warning",
      `Origin parent-drop ${originParentDrop.id} parent ids do not match source family ${originGroup.id}.`,
      boundsModel,
      [originParentDrop.id]
    ));
  }
  if (!parentDropXWithinParents(layout, originParentDrop, originGroup.parentIds)) {
    diagnostics.push(originDiagnostic(
      constraint,
      "warning",
      `Origin parent-drop ${originParentDrop.id} is outside source parent bounds.`,
      boundsModel,
      [originParentDrop.id]
    ));
  }

  const coreSegments = layout.relationshipSegments.filter((segment) => segment.unionId === coreUnionId);
  for (const segment of coreSegments) {
    const mixedOriginParent = originGroup.parentIds.find((parentId) =>
      segment.childIds?.includes(parentId) ||
      segment.parentIds?.includes(parentId) ||
      segment.source?.childIds?.includes(parentId) ||
      segment.source?.parentIds?.includes(parentId)
    );
    if (!mixedOriginParent) continue;
    diagnostics.push(originDiagnostic(
      constraint,
      "warning",
      `Core segment ${segment.id} mixes origin parent ${mixedOriginParent}.`,
      boundsModel,
      [segment.id]
    ));
  }

  return diagnostics;
}

function originDiagnostic(
  constraint: LayoutConstraint,
  severity: LayoutDiagnosticSeverity,
  message: string,
  boundsModel: GroupBoxBoundsModel,
  segmentIds: string[] = []
): LayoutDiagnostic {
  const boxIds = constraint.groupIds
    .map((groupId) => findGroupBoxBounds(boundsModel, groupId)?.boxId)
    .filter(isString);
  return {
    id: `origin-family-crosses-core-family:${constraint.id}`,
    kind: "origin-family-crosses-core-family",
    severity,
    message,
    groupIds: constraint.groupIds,
    boxIds,
    unionIds: constraint.unionIds,
    personIds: constraint.personIds,
    segmentIds
  };
}

function parentDropXWithinParents(
  layout: LayoutResult,
  segment: { points: Array<{ x: number; y: number }> },
  parentIds: string[]
): boolean {
  const xs = parentIds
    .map((personId) => layout.nodes.find((node) => node.id === personId)?.x)
    .filter((x): x is number => Number.isFinite(x));
  if (xs.length === 0 || segment.points.length === 0) return true;
  const dropX = segment.points[0].x;
  return dropX >= Math.min(...xs) - 1 && dropX <= Math.max(...xs) + 1;
}

function sameMembers(actual: string[], expected: string[]): boolean {
  const left = [...actual].sort();
  const right = [...expected].sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function pointBounds(personId: string, groupBounds: GroupBoxBounds): GroupBoxBounds | undefined {
  if (!groupBounds.personIds.includes(personId)) return undefined;
  const widthPerPerson = groupBounds.width / Math.max(groupBounds.personIds.length, 1);
  const sortedPersonIds = [...groupBounds.personIds].sort();
  const index = sortedPersonIds.indexOf(personId);
  if (index < 0) return undefined;
  const xMin = groupBounds.xMin + widthPerPerson * index;
  const xMax = xMin + widthPerPerson;
  return {
    ...groupBounds,
    id: `${groupBounds.id}:${personId}`,
    personIds: [personId],
    xMin,
    xMax,
    width: xMax - xMin
  };
}

function nodeBounds(personId: string, x: number, y: number): GroupBoxBounds {
  const half = NODE_SIZE / 2;
  return {
    id: `node:${personId}`,
    role: "person",
    unionIds: [],
    personIds: [personId],
    parentIds: [],
    childIds: [],
    xMin: x - half,
    yMin: y - half,
    xMax: x + half,
    yMax: y + half,
    width: NODE_SIZE,
    height: NODE_SIZE
  };
}

function parentUnionForPerson(graph: PedigreeGraph, personId: string): string | undefined {
  for (const [unionId, childIds] of graph.childrenMap.entries()) {
    if (childIds.includes(personId)) return unionId;
  }
  return undefined;
}

function hasRole(group: RelationshipGroup, personId: string, role: string): boolean {
  return group.roles.some((entry) => entry.personId === personId && entry.role === role);
}

function sortedChildrenMap(graph: PedigreeGraph): Array<[string, string[]]> {
  return [...graph.childrenMap.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function normalizeDiagnostic(diagnostic: LayoutDiagnostic): LayoutDiagnostic {
  return {
    ...diagnostic,
    groupIds: diagnostic.groupIds ? unique(diagnostic.groupIds).sort() : undefined,
    boxIds: diagnostic.boxIds ? unique(diagnostic.boxIds).sort() : undefined,
    unionIds: diagnostic.unionIds ? unique(diagnostic.unionIds).sort() : undefined,
    personIds: diagnostic.personIds ? unique(diagnostic.personIds).sort() : undefined,
    segmentIds: diagnostic.segmentIds ? unique(diagnostic.segmentIds).sort() : undefined
  };
}

function compareDiagnostic(a: LayoutDiagnostic, b: LayoutDiagnostic): number {
  return a.id.localeCompare(b.id) ||
    a.kind.localeCompare(b.kind) ||
    a.severity.localeCompare(b.severity);
}

function sameValues(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isString(value: string | undefined): value is string {
  return typeof value === "string";
}
