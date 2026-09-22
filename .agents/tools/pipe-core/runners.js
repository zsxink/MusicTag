'use strict';

const preflight = require('./preflight.js');

function pending(name) {
  return async () => ({
    ok: false,
    error: { kind: 'config', message: `deterministic runner ${name} 尚未装配`, retryable: false },
  });
}

module.exports = {
  bootstrap: preflight.bootstrap,
  'spec-gate': preflight.specGate,
  verify: pending('verify'),
  integrate: pending('integrate'),
};
