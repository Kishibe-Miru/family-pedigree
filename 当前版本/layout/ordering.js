"use strict";

/* global window */

window.PedigreeLayout = window.PedigreeLayout || {};

function byBirthOrder(a, b) {
  return (a.order || 0) - (b.order || 0);
}

window.PedigreeLayout.byBirthOrder = byBirthOrder;
