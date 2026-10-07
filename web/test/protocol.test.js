const test = require("node:test");
const assert = require("node:assert/strict");
const { initialState, parseMessage, validateSetLed, validateSetAll, applyControlCommand } = require("../src/protocol");

test("creates five controls switched off", () => {
  assert.deepEqual(initialState(), [{ id: 1, on: false }, { id: 2, on: false }, { id: 3, on: false }, { id: 4, on: false }, { id: 5, on: false }]);
});
test("parses JSON messages", () => {
  assert.deepEqual(parseMessage('{"type":"get_state"}'), { message: { type: "get_state" } });
  assert.match(parseMessage("bad").error, /JSON/);
});
test("validates LED commands", () => {
  assert.deepEqual(validateSetLed({ id: 2, on: true }), { id: 2, on: true });
  assert.deepEqual(validateSetLed({ id: 5, on: true }), { id: 5, on: true });
  assert.ok(validateSetLed({ id: 6, on: true }).error);
  assert.ok(validateSetLed({ id: 1, on: 1 }).error);
  assert.deepEqual(validateSetAll({ on: false }), { on: false });
  assert.ok(validateSetAll({ on: true }).error);
});
test("opposing drive controls cannot remain on together", () => {
  const forward = applyControlCommand(initialState(), 1, true);
  const backward = applyControlCommand(forward, 2, true);
  assert.equal(backward[0].on, false);
  assert.equal(backward[1].on, true);
});
