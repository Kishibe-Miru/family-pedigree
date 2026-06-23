"use strict";

/* global window */

window.PedigreeDomain = window.PedigreeDomain || {};

/**
 * @typedef {Object} Phenotype
 * @property {string} id
 * @property {string} personId
 * @property {"unaffected"|"affected"|"suspected"|"unknown"} status
 * @property {string[]} diagnoses
 * @property {string} ageOfOnset
 * @property {string} source
 */

function normalizePhenotype(input) {
  return {
    id: input.id,
    personId: input.personId,
    status: input.status || "unaffected",
    diagnoses: Array.isArray(input.diagnoses) ? input.diagnoses : [],
    ageOfOnset: input.ageOfOnset || "",
    source: input.source || ""
  };
}

window.PedigreeDomain.normalizePhenotype = normalizePhenotype;
