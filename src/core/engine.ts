import { PedigreeGraph } from "../model/pedigreeGraph";
import { validateGraph } from "../rules/validation";
import { computeLayout } from "../layout/computeLayout";
import { buildLayoutResult } from "../layout/layoutResultBuilder";
import { LayoutInput } from "../model/layoutResult";
import { renderLayoutResultToSvg } from "../render/svgRenderer";

// Architecture checks:
// - No person-person edges exist.
// - All relationships use UnionNode.
// - Layout is independent from rendering.
// - Rendering contains no graph logic.
export function buildPedigree(graph: PedigreeGraph) {
  const g1 = validateGraph(graph);
  const g2 = computeLayout(g1);
  return renderLayoutResultToSvg(buildLayoutResult(g2, layoutInputFromGraph(g2)));
}

function layoutInputFromGraph(graph: PedigreeGraph): LayoutInput {
  return {
    persons: [...graph.persons.values()].map((person) => ({
      id: person.id,
      sex: person.sex,
      birthOrder: person.birthOrder
    })),
    unions: [...graph.unions.values()].map((union) => ({
      id: union.id,
      partners: [...union.partners]
    })),
    childrenMap: [...graph.childrenMap.entries()].map(([unionId, childIds]) => [unionId, [...childIds]])
  };
}
