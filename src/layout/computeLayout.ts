import { PedigreeGraph } from "../model/pedigreeGraph";
import { assignLayers } from "./layerAssigner";
import { reduceCrossings } from "./crossingReducer";
import { assignCoordinates } from "./coordinateSolver";

export function computeLayout(graph: PedigreeGraph) {
  let g = assignLayers(graph);
  g = reduceCrossings(g);
  g = assignCoordinates(g);
  return g;
}
