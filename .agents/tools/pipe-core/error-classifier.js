'use strict';

const PERMANENT = new Set(['auth', 'config', 'schema', 'permission']);
const TRANSIENT = new Set(['timeout', 'network', 'protocol', 'spawn', 'agent', 'command']);
const STATE_MACHINE = new Set(['branch-behind', 'no-checks-yet', 'already-merged']);

function classifyError(error) {
  const kind = typeof error === 'string' ? error : (error && error.kind) || 'unknown';
  if (PERMANENT.has(kind)) return { kind, category: 'permanent', retryable: false };
  if (TRANSIENT.has(kind)) return { kind, category: 'transient', retryable: true };
  if (STATE_MACHINE.has(kind)) return { kind, category: 'state-machine', retryable: false };
  return { kind, category: 'unknown', retryable: false };
}

function retryDisposition({ kind, attempts, retryMax, forceRetry = false }) {
  const classified = classifyError({ kind });
  if (forceRetry) return { ...classified, action: 'retry', forced: true };
  if (classified.category === 'permanent') return { ...classified, action: 'escalate' };
  if (classified.category === 'state-machine') return { ...classified, action: 'handle' };
  if (classified.category === 'transient' && attempts <= retryMax) return { ...classified, action: 'retry' };
  if (classified.category === 'transient') return { ...classified, action: 'escalate' };
  return { ...classified, action: 'decide' };
}

module.exports = { classifyError, retryDisposition, PERMANENT, TRANSIENT, STATE_MACHINE };
