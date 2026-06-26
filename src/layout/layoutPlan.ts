import { PedigreeGraph } from "../model/pedigreeGraph";
import { sortChildrenForLayout } from "./childOrdering";
import { buildRelationshipGroups, RelationshipGroupModel } from "./relationshipGroups";

export interface LayoutSiblingGroupPlan {
  unionId: string;
  parentIds: string[];
  childIds: string[];
  orderedChildIds: string[];
}

export interface LayoutOriginSeparationPlan {
  id: string;
  groupIds: string[];
  personIds: string[];
  unionIds: string[];
  sharedPersonId: string;
  originUnionId: string;
  coreUnionId: string;
}

export interface LayoutPlan {
  relationshipGroups: RelationshipGroupModel;
  siblingGroups: LayoutSiblingGroupPlan[];
  originSeparations: LayoutOriginSeparationPlan[];
}

export function buildLayoutPlan(graph: PedigreeGraph): LayoutPlan {
  const relationshipGroups = buildRelationshipGroups(graph);
  const siblingGroups = relationshipGroups.groups
    .filter((group) => group.kind === "sibling-group" && group.unionId)
    .map((group) => ({
      unionId: group.unionId as string,
      parentIds: [...group.parentIds],
      childIds: [...group.childIds],
      orderedChildIds: sortChildrenForLayout(graph, group.childIds)
    }));
  const originSeparations = relationshipGroups.constraints
    .filter((constraint) => constraint.kind === "origin-family-separated")
    .map((constraint) => ({
      id: constraint.id,
      groupIds: [...constraint.groupIds],
      personIds: [...constraint.personIds],
      unionIds: [...constraint.unionIds],
      sharedPersonId: constraint.personIds[0] ?? "",
      originUnionId: constraint.unionIds[0] ?? "",
      coreUnionId: constraint.unionIds[1] ?? ""
    }));

  return {
    relationshipGroups,
    siblingGroups,
    originSeparations
  };
}
