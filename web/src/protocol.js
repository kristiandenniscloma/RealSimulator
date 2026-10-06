const LED_COUNT = 5;
const OPPOSITE_CONTROLS = { 1: 2, 2: 1, 3: 4, 4: 3 };

function initialState() {
  return Array.from({ length: LED_COUNT }, (_, index) => ({ id: index + 1, on: false }));
}

function parseMessage(raw) {
  let message;
  try { message = JSON.parse(raw.toString()); }
  catch { return { error: "Message must be valid JSON" }; }
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return { error: "Message must be a JSON object" };
  }
  return { message };
}

function validateSetLed(message) {
  const id = Number(message.id);
  if (!Number.isInteger(id) || id < 1 || id > LED_COUNT) return { error: `id must be an integer from 1 to ${LED_COUNT}` };
  if (typeof message.on !== "boolean") return { error: "on must be a boolean" };
  return { id, on: message.on };
}

function validateSetAll(message) {
  if (typeof message.on !== "boolean") return { error: "on must be a boolean" };
  if (message.on) return { error: "set_all only supports OFF for safety" };
  return { on: message.on };
}

function applyControlCommand(state, id, on) {
  const opposite = OPPOSITE_CONTROLS[id];
  return state.map((control) => {
    if (control.id === id) return { ...control, on };
    if (on && control.id === opposite) return { ...control, on: false };
    return control;
  });
}

module.exports = { LED_COUNT, initialState, parseMessage, validateSetLed, validateSetAll, applyControlCommand };
