const LED_COUNT = 4;

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
  return { on: message.on };
}

module.exports = { LED_COUNT, initialState, parseMessage, validateSetLed, validateSetAll };
