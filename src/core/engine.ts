import { PedigreeGraph } from "../model/pedigreeGraph";
import { validateGraph } from "../rules/validation";
import { computeLayout } from "../layout/computeLayout";
import { render } from "../render/svgRenderer";

// Architecture checks:
// - No person-person edges exist.
// - All relationships use UnionNode.
// - Layout is independent from rendering.
// - Rendering contains no graph logic.
export function buildPedigree(graph: PedigreeGraph) {
  const g1 = validateGraph(graph);
  const g2 = computeLayout(g1);
  return render(g2);
}
