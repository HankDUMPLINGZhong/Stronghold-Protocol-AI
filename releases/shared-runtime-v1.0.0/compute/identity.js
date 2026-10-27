// A strategy view/proxy can identify its real host without coupling the runtime to that strategy.
export const COMPUTATION_OWNER = Symbol.for('stronghold.ai.compute.owner.v1');
export const computationOwner = match => match[COMPUTATION_OWNER] || match;
