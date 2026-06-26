import { PedigreeGraph } from "../model/pedigreeGraph";

export function sortChildrenForLayout(graph: PedigreeGraph, childIds: readonly string[]): string[] {
  const groups = new Map<string, string[]>();
  const singles: string[] = [];

  for (const childId of childIds) {
    const twinGroup = graph.persons.get(childId)?.twinGroup;
    if (!twinGroup) {
      singles.push(childId);
      continue;
    }
    if (!groups.has(twinGroup)) groups.set(twinGroup, []);
    groups.get(twinGroup)?.push(childId);
  }

  const blocks = [
    ...singles.map((id) => ({ ids: [id], key: childSortKey(graph, [id]) })),
    ...[...groups.values()].map((ids) => ({
      ids: [...ids].sort((a, b) => childSortKey(graph, [a]).localeCompare(childSortKey(graph, [b]))),
      key: childSortKey(graph, ids)
    }))
  ];

  return blocks
    .sort((a, b) => a.key.localeCompare(b.key))
    .flatMap((block) => block.ids);
}

function childSortKey(graph: PedigreeGraph, ids: readonly string[]): string {
  const orders = ids.map((id) => graph.persons.get(id)?.birthOrder ?? Number.MAX_SAFE_INTEGER);
  const order = Math.min(...orders);
  const firstId = [...ids].sort()[0] ?? "";
  return `${order.toString().padStart(16, "0")}:${firstId}`;
}
