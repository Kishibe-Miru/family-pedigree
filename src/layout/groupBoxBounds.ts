import { LayoutResult } from "../model/layoutResult";
import {
  LayoutBoxRole,
  RelationshipGroupKind,
  RelationshipGroupModel
} from "./relationshipGroups";

export type GroupBoxBounds = {
  id: string;
  boxId?: string;
  groupId?: string;
  role: LayoutBoxRole;
  kind?: RelationshipGroupKind;
  unionIds: string[];
  personIds: string[];
  parentIds: string[];
  childIds: string[];
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  width: number;
  height: number;
  source?: {
    unionId?: string;
    parentIds?: string[];
    childIds?: string[];
    personIds?: string[];
  };
  requiresDescendantSpace?: boolean;
  isSemanticView?: boolean;
  linkedFamilyGroupId?: string;
};

export type GroupBoxBoundsModel = {
  bounds: GroupBoxBounds[];
};

const DEFAULT_NODE_WIDTH = 72;
const DEFAULT_NODE_HEIGHT = 72;
const DEFAULT_BOX_PADDING = 24;

export function deriveGroupBoxBounds(
  layout: LayoutResult,
  groupModel: RelationshipGroupModel
): GroupBoxBoundsModel {
  const nodeById = new Map(layout.nodes.map((node) => [node.id, node]));
  const bounds: GroupBoxBounds[] = [];

  for (const group of [...groupModel.groups].sort((a, b) => a.id.localeCompare(b.id))) {
    if (group.isSemanticView) continue;

    for (const box of [...group.boxes].sort((a, b) => a.id.localeCompare(b.id))) {
      const personIds = box.role === "sibling-group" ? [...box.childIds] : [...box.personIds];
      const nodes = personIds
        .map((personId) => nodeById.get(personId))
        .filter((node): node is NonNullable<typeof node> => !!node);
      if (nodes.length === 0) continue;

      const xMin = Math.min(...nodes.map((node) => node.x - DEFAULT_NODE_WIDTH / 2)) - DEFAULT_BOX_PADDING;
      const xMax = Math.max(...nodes.map((node) => node.x + DEFAULT_NODE_WIDTH / 2)) + DEFAULT_BOX_PADDING;
      const yMin = Math.min(...nodes.map((node) => node.y - DEFAULT_NODE_HEIGHT / 2)) - DEFAULT_BOX_PADDING;
      const yMax = Math.max(...nodes.map((node) => node.y + DEFAULT_NODE_HEIGHT / 2)) + DEFAULT_BOX_PADDING;

      bounds.push({
        id: box.id,
        boxId: box.id,
        groupId: group.id,
        role: box.role,
        kind: group.kind,
        unionIds: [...box.unionIds],
        personIds,
        parentIds: [...box.parentIds],
        childIds: [...box.childIds],
        xMin,
        yMin,
        xMax,
        yMax,
        width: xMax - xMin,
        height: yMax - yMin,
        source: box.source ? {
          unionId: box.source.unionId,
          parentIds: box.source.parentIds ? [...box.source.parentIds] : undefined,
          childIds: box.source.childIds ? [...box.source.childIds] : undefined,
          personIds: box.source.personIds ? [...box.source.personIds] : undefined
        } : undefined,
        requiresDescendantSpace: group.requiresDescendantSpace,
        isSemanticView: group.isSemanticView,
        linkedFamilyGroupId: group.linkedFamilyGroupId
      });
    }
  }

  return { bounds: bounds.sort((a, b) => a.id.localeCompare(b.id)) };
}

export function findGroupBoxBounds(
  model: GroupBoxBoundsModel,
  id: string
): GroupBoxBounds | undefined {
  return model.bounds.find((bounds) =>
    bounds.id === id ||
    bounds.boxId === id ||
    bounds.groupId === id
  );
}

export function boundsOverlap(
  a: GroupBoxBounds,
  b: GroupBoxBounds,
  tolerance = 0
): boolean {
  return a.xMin < b.xMax - tolerance &&
    a.xMax > b.xMin + tolerance &&
    a.yMin < b.yMax - tolerance &&
    a.yMax > b.yMin + tolerance;
}

export function boundsContainPoint(
  bounds: GroupBoxBounds,
  point: { x: number; y: number },
  tolerance = 0
): boolean {
  return point.x >= bounds.xMin - tolerance &&
    point.x <= bounds.xMax + tolerance &&
    point.y >= bounds.yMin - tolerance &&
    point.y <= bounds.yMax + tolerance;
}
