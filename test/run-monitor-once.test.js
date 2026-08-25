const assert = require('assert');
const { main } = require('../scripts/run-monitor-once');

async function testSuccessfulRunExitsZero() {
  let exitCode = null;
  await main({
    run: async () => ({ success: true, newCount: 0 }),
    exit: (code) => { exitCode = code; },
  });
  assert.strictEqual(exitCode, 0);
}

async function testFailedRunStillExitsZero() {
  let exitCode = null;
  await main({
    run: async () => ({ success: false, newCount: 0, error: 'network timeout' }),
    exit: (code) => { exitCode = code; },
  });
  assert.strictEqual(exitCode, 0);
}

async function testUnexpectedErrorExitsOne() {
  let exitCode = null;
  await main({
    run: async () => { throw new Error('boom'); },
    exit: (code) => { exitCode = code; },
  });
  assert.strictEqual(exitCode, 1);
}

async function run() {
  await testSuccessfulRunExitsZero();
  await testFailedRunStillExitsZero();
  await testUnexpectedErrorExitsOne();
  console.log('✅ run-monitor-once exit behavior assertions passed.');
}

run();
