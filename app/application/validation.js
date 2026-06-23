"use strict";

/* global window */

window.PedigreeApplication = window.PedigreeApplication || {};

function validateDomainProject(project) {
  if (!project || !Array.isArray(project.people)) throw new Error("invalid");
  if (!Array.isArray(project.unions)) throw new Error("unions must be an array");
  if (!Array.isArray(project.parentages)) throw new Error("parentages must be an array");
  const people = new Set();
  project.people.forEach((p, i) => {
    if (!p?.id) throw new Error(`person id missing at ${i + 1}`);
    if (people.has(p.id)) throw new Error(`duplicate person id: ${p.id}`);
    people.add(p.id);
  });
  if (project.people.filter((p) => p.proband).length > 1) throw new Error("multiple probands");

  const unions = new Set();
  const unionKeys = new Set();
  project.unions.forEach((u, i) => {
    if (!u?.id) throw new Error(`union id missing at ${i + 1}`);
    if (unions.has(u.id)) throw new Error(`duplicate union id: ${u.id}`);
    unions.add(u.id);
    if (!Array.isArray(u.partnerIds) || u.partnerIds.length === 0 || u.partnerIds.length > 2) throw new Error(`invalid union partners at ${i + 1}`);
    u.partnerIds.forEach((id) => { if (!people.has(id)) throw new Error(`broken union partner reference: ${id}`); });
    const key = [...u.partnerIds].sort().join("|");
    if (unionKeys.has(key)) throw new Error(`duplicate union partners: ${key}`);
    unionKeys.add(key);
  });

  const parentageKeys = new Set();
  const parentEdges = [];
  project.parentages.forEach((pa, i) => {
    if (!pa?.id) throw new Error(`parentage id missing at ${i + 1}`);
    if (!unions.has(pa.unionId)) throw new Error(`broken parentage union reference: ${pa.unionId}`);
    if (!people.has(pa.childId)) throw new Error(`broken parentage child reference: ${pa.childId}`);
    if (!Array.isArray(pa.parentIds) || pa.parentIds.length === 0 || pa.parentIds.length > 2) throw new Error(`invalid parentage parents at ${i + 1}`);
    pa.parentIds.forEach((id) => {
      if (!people.has(id)) throw new Error(`broken parentage parent reference: ${id}`);
      if (id === pa.childId) throw new Error("person cannot be own parent");
      parentEdges.push([id, pa.childId]);
    });
    const key = `${pa.unionId}:${pa.childId}`;
    if (parentageKeys.has(key)) throw new Error(`duplicate parentage: ${key}`);
    parentageKeys.add(key);
  });
  assertNoDomainParentCycle(parentEdges);
}

function assertNoDomainParentCycle(edges) {
  const graph = new Map();
  edges.forEach(([parent, child]) => {
    if (!graph.has(parent)) graph.set(parent, []);
    graph.get(parent).push(child);
  });
  const visiting = new Set();
  const done = new Set();
  function visit(id) {
    if (visiting.has(id)) throw new Error("parentage cycle detected");
    if (done.has(id)) return;
    visiting.add(id);
    (graph.get(id) || []).forEach(visit);
    visiting.delete(id);
    done.add(id);
  }
  [...graph.keys()].forEach(visit);
}

window.PedigreeApplication.validateDomainProject = validateDomainProject;
