import { PedigreeGraph } from "../model/pedigreeGraph";

export function render(graph: PedigreeGraph): string {
  let nodes = "";

  for (const p of graph.persons.values()) {
    nodes += `<circle cx="0" cy="0" r="10"></circle>`;
  }

  return `<svg>${nodes}</svg>`;
}
