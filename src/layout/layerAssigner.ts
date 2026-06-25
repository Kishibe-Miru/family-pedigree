import { PedigreeGraph } from "../model/pedigreeGraph";

export function assignLayers(graph: PedigreeGraph) {
  for (const person of graph.persons.values()) {
    person.generation = 0;
  }

  const limit = graph.persons.size + graph.unions.size + 1;
  for (let i = 0; i < limit; i++) {
    let changed = false;

    for (const union of graph.unions.values()) {
      const partnerGenerations = union.partners.map((id) => graph.persons.get(id)?.generation ?? 0);
      const partnerGeneration = Math.max(...partnerGenerations);

      for (const partnerId of union.partners) {
        const partner = graph.persons.get(partnerId);
        if (partner && (partner.generation ?? 0) < partnerGeneration) {
          partner.generation = partnerGeneration;
          changed = true;
        }
      }

      const children = graph.childrenMap.get(union.id) ?? [];
      for (const childId of children) {
        const child = graph.persons.get(childId);
        if (!child) continue;
        const nextGeneration = partnerGeneration + 1;
        if ((child.generation ?? 0) < nextGeneration) {
          child.generation = nextGeneration;
          changed = true;
        }
      }
    }

    if (!changed) break;
  }

  return graph;
}

export function formatGenerations(graph: PedigreeGraph): string {
  return [...graph.persons.values()]
    .sort((a, b) => (a.generation ?? 0) - (b.generation ?? 0) || a.id.localeCompare(b.id))
    .map((person) => `${person.id}: generation ${person.generation ?? 0}`)
    .join("\n");
}
