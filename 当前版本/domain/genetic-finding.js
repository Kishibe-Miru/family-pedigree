"use strict";

/* global window */

window.PedigreeDomain = window.PedigreeDomain || {};

/**
 * @typedef {Object} GeneticFinding
 * @property {string} id
 * @property {string} personId
 * @property {"carrier"|"positive"|"negative"|"vus"|"unknown"} status
 * @property {string} gene
 * @property {string} variant
 * @property {string} source
 */

function normalizeGeneticFinding(input) {
  return {
    id: input.id,
    personId: input.personId,
    status: input.status || "unknown",
    gene: input.gene || "",
    variant: input.variant || "",
    source: input.source || ""
  };
}

window.PedigreeDomain.normalizeGeneticFinding = normalizeGeneticFinding;
