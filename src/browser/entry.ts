import { computeLayout } from "../layout/computeLayout";
import {
  applyManualNodePositionsToLayout,
  buildLayoutResult,
  normalizePartners
} from "../layout/layoutResultBuilder";
import { LayoutInput, LayoutPosition, LayoutResult } from "../model/layoutResult";
import { PedigreeGraph } from "../model/pedigreeGraph";
import { GraphValidationError, validateGraph } from "../rules/validation";

export { applyManualNodePositionsToLayout };
export type { FinalizeLayoutOptions } from "../layout/layoutResultBuilder";
export type { LayoutInput, LayoutPosition, LayoutResult } from "../model/layoutResult";

export interface LayoutSuccess {
  ok: true;
  layout: LayoutResult;
}

export interface LayoutFailure {
  ok: false;
  error: {
    message: string;
    code?: string;
    details?: unknown;
  };
}

export type LayoutResponse = LayoutSuccess | LayoutFailure;

declare global {
  var PedigreeEngine: {
    layout: typeof layout;
    layoutResult: typeof layoutResult;
    layoutPositions: typeof layoutPositions;
    applyManualNodePositionsToLayout: typeof applyManualNodePositionsToLayout;
  };
}

export function layout(input: LayoutInput): LayoutResponse {
  try {
    validateLayoutInput(input);
    const graph = layoutInputToGraph(input);
    const validGraph = validateGraph(graph);
    const laidOutGraph = computeLayout(validGraph);

    return { ok: true, layout: buildLayoutResult(laidOutGraph, input) };
  } catch (error) {
    const failure = layoutFailure(error);
    console.error("[PedigreeEngine] layout failed:", failure.error.message, failure.error);
    return failure;
  }
}

export function layoutResult(input: LayoutInput): LayoutResult | null {
  const response = layout(input);
  return response.ok ? response.layout : null;
}

export function layoutPositions(input: LayoutInput): LayoutPosition[] | null {
  const result = layoutResult(input);
  return result ? result.positions : null;
}

export function legacyPositions(result: LayoutResult): LayoutPosition[] {
  return result.positions;
}

export function validateLayoutInput(input: LayoutInput): void {
  if (!input || !Array.isArray(input.persons)) {
    throw new GraphValidationError("LAYOUT_INPUT_PERSONS_INVALID", "layout input persons must be an array", { input });
  }
  if (!Array.isArray(input.unions)) {
    throw new GraphValidationError("LAYOUT_INPUT_UNIONS_INVALID", "layout input unions must be an array", { input });
  }
  if (!Array.isArray(input.childrenMap)) {
    throw new GraphValidationError("LAYOUT_INPUT_CHILDREN_MAP_INVALID", "layout input childrenMap must be an array of [unionId, childIds] entries", { input });
  }

  assertUniqueIds(input.persons.map((person) => person.id), "person");
  assertUniqueIds(input.unions.map((union) => union.id), "union");
  validateUnionPartners(input);
  validateChildrenMapEntries(input.childrenMap);
}

function layoutInputToGraph(input: LayoutInput): PedigreeGraph {
  const childCountByUnion = new Map(input.childrenMap.map(([unionId, childIds]) => [unionId, childIds.length]));
  const relevantUnions = input.unions
    .map((union) => ({ id: union.id, partners: normalizePartners(union) }))
    .filter((union) => union.partners.length > 1 || (childCountByUnion.get(union.id) ?? 0) > 0);
  const relevantUnionIds = new Set(relevantUnions.map((union) => union.id));

  return {
    persons: new Map(input.persons.map((person) => [
      person.id,
      {
        id: person.id,
        sex: person.sex,
        birthOrder: person.birthOrder,
        twinGroup: person.twinGroup,
        twinType: person.twinType
      }
    ])),
    unions: new Map(relevantUnions.map((union) => [
      union.id,
      union
    ])),
    childrenMap: new Map(input.childrenMap
      .filter(([unionId, childIds]) => childIds.length > 0 || relevantUnionIds.has(unionId))
      .map(([unionId, childIds]) => [unionId, [...childIds]]))
  };
}

function assertUniqueIds(ids: string[], kind: "person" | "union") {
  const seen = new Set<string>();
  for (const id of ids) {
    if (!id) {
      throw new GraphValidationError(
        kind === "person" ? "GRAPH_PERSON_ID_EMPTY" : "GRAPH_UNION_ID_EMPTY",
        `${kind} id must be non-empty`,
        { id }
      );
    }
    if (seen.has(id)) {
      throw new GraphValidationError(
        kind === "person" ? "GRAPH_PERSON_ID_DUPLICATE" : "GRAPH_UNION_ID_DUPLICATE",
        `duplicate ${kind} id ${id}`,
        { id }
      );
    }
    seen.add(id);
  }
}

function validateUnionPartners(input: LayoutInput) {
  for (const union of input.unions) {
    if (!Array.isArray(union.partners)) {
      throw new GraphValidationError(
        "LAYOUT_INPUT_UNION_PARTNERS_INVALID",
        `union ${union.id} partners must be an array`,
        { unionId: union.id, partners: union.partners }
      );
    }
    for (const partnerId of union.partners) {
      if (!partnerId) {
        throw new GraphValidationError(
          "LAYOUT_INPUT_UNION_PARTNER_EMPTY",
          `union ${union.id} contains an empty partner id`,
          { unionId: union.id, partners: union.partners }
        );
      }
    }
  }
}

function validateChildrenMapEntries(childrenMap: LayoutInput["childrenMap"]) {
  const seenUnionIds = new Set<string>();

  for (const entry of childrenMap) {
    if (!Array.isArray(entry) || entry.length !== 2 || !Array.isArray(entry[1])) {
      throw new GraphValidationError(
        "LAYOUT_INPUT_CHILDREN_MAP_ENTRY_INVALID",
        "childrenMap entries must be [unionId, childIds[]]",
        { entry }
      );
    }

    const [unionId, childIds] = entry;
    if (!unionId) {
      throw new GraphValidationError(
        "LAYOUT_INPUT_CHILDREN_MAP_UNION_EMPTY",
        "childrenMap union id must be non-empty",
        { entry }
      );
    }
    if (seenUnionIds.has(unionId)) {
      throw new GraphValidationError(
        "LAYOUT_INPUT_CHILDREN_MAP_UNION_DUPLICATE",
        `childrenMap contains duplicate union entry ${unionId}`,
        { unionId }
      );
    }
    seenUnionIds.add(unionId);

    const seenChildIds = new Set<string>();
    for (const childId of childIds) {
      if (!childId) {
        throw new GraphValidationError(
          "LAYOUT_INPUT_CHILDREN_MAP_CHILD_EMPTY",
          `childrenMap entry ${unionId} contains an empty child id`,
          { unionId, childIds }
        );
      }
      if (seenChildIds.has(childId)) {
        throw new GraphValidationError(
          "LAYOUT_INPUT_CHILDREN_MAP_CHILD_DUPLICATE",
          `childrenMap entry ${unionId} contains duplicate child id ${childId}`,
          { unionId, childId }
        );
      }
      seenChildIds.add(childId);
    }
  }
}

function layoutFailure(error: unknown): LayoutFailure {
  if (error instanceof GraphValidationError) {
    return {
      ok: false,
      error: {
        message: error.message,
        code: error.code,
        details: error.details
      }
    };
  }
  if (error instanceof Error) {
    return {
      ok: false,
      error: {
        message: error.message || "layout failed"
      }
    };
  }
  return {
    ok: false,
    error: {
      message: "layout failed",
      details: error
    }
  };
}

globalThis.PedigreeEngine = { layout, layoutResult, layoutPositions, applyManualNodePositionsToLayout };
