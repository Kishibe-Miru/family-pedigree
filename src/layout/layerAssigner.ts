import { PedigreeGraph } from "../model/pedigreeGraph";

export function assignLayers(graph: PedigreeGraph) {
  for (const p of graph.persons.values()) {
    if (p.generation === undefined) {
      p.generation = 0;
    }
  }
  return graph;
}
