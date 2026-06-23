"use strict";

/* global window */

window.PedigreeLayout = window.PedigreeLayout || {};

function generationKey(generation) {
  return Number.isFinite(generation) ? generation : 0;
}

window.PedigreeLayout.generationKey = generationKey;
