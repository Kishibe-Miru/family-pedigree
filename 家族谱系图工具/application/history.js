"use strict";

/* global window */

window.PedigreeApplication = window.PedigreeApplication || {};

function createHistory(limit) {
  return {
    past: [],
    future: [],
    push(snapshot) {
      this.past.push(snapshot);
      if (this.past.length > limit) this.past.shift();
      this.future = [];
    }
  };
}

window.PedigreeApplication.createHistory = createHistory;
