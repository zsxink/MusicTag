'use strict';

const preflight = require('./preflight.js');
const verify = require('./verify.js');
const integrate = require('./integrate.js');

module.exports = {
  bootstrap: preflight.bootstrap,
  'spec-gate': preflight.specGate,
  verify: (ctx) => verify.runVerify(ctx),
  integrate: (ctx) => integrate.runIntegrate(ctx),
};
