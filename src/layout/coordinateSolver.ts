import { PedigreeGraph } from "../model/pedigreeGraph";

export function assignCoordinates(graph: PedigreeGraph) {
  let x = 0;

  for (const p of graph.persons.values()) {
    if (p.birthOrder === undefined) {
      p.birthOrder = x++;
    }
  }

  return graph;
}
