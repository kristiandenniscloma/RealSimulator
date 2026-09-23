const test = require("node:test");
const assert = require("node:assert/strict");
const { initialState, parseMessage, validateSetLed, validateSetAll } = require("../src/protocol");

test("creates four LEDs switched off", () => {
  assert.deepEqual(initialState(), [{ id: 1, on: false }, { id: 2, on: false }, { id: 3, on: false }, { id: 4, on: false }]);
});
test("parses JSON messages", () => {
  assert.deepEqual(parseMessage('{"type":"get_state"}'), { message: { type: "get_state" } });
  assert.match(parseMessage("bad").error, /JSON/);
});
test("validates LED commands", () => {
  assert.deepEqual(validateSetLed({ id: 2, on: true }), { id: 2, on: true });
  assert.ok(validateSetLed({ id: 5, on: true }).error);
  assert.ok(validateSetLed({ id: 1, on: 1 }).error);
  assert.deepEqual(validateSetAll({ on: false }), { on: false });
});
