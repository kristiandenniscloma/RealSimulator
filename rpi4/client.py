import asyncio
import json
import logging
import os
from contextlib import suppress

from websockets.asyncio.client import connect

WS_URL = os.getenv("WS_URL", "wss://realsimulator.onrender.com/ws")
PINS = [int(value) for value in os.getenv("GPIO_PINS", "17,27,22,23").split(",")]
MOCK_GPIO = os.getenv("MOCK_GPIO", "").lower() in {"1", "true", "yes"}
if len(PINS) != 4:
    raise ValueError("GPIO_PINS must contain exactly four BCM pin numbers")


class LedBoard:
    def __init__(self, pins, mock=False):
        self.mock = mock
        self.states = [False] * len(pins)
        if mock:
            self.outputs = []
            logging.info("Using mock GPIO on BCM pins %s", pins)
        else:
            from gpiozero import LED
            self.outputs = [LED(pin, initial_value=False) for pin in pins]

    def apply(self, leds):
        by_id = {int(led["id"]): bool(led["on"]) for led in leds}
        for index in range(len(self.states)):
            state = by_id.get(index + 1, False)
            self.states[index] = state
            if not self.mock:
                self.outputs[index].value = state
        logging.info("LED state: %s", ["ON" if state else "OFF" for state in self.states])

    def close(self):
        for output in self.outputs:
            output.off()
            output.close()


async def run(board):
    delay = 1
    while True:
        try:
            logging.info("Connecting to %s", WS_URL)
            async with connect(WS_URL, ping_interval=20, ping_timeout=20) as socket:
                await socket.send(json.dumps({"type": "auth", "role": "device"}))
                delay = 1
                async for raw in socket:
                    message = json.loads(raw)
                    if message.get("type") == "state":
                        board.apply(message.get("leds", []))
                        await socket.send(json.dumps({"type": "applied", "leds": [{"id": i + 1, "on": state} for i, state in enumerate(board.states)]}))
                    elif message.get("type") == "error":
                        logging.error("Server error: %s", message.get("message"))
        except asyncio.CancelledError:
            raise
        except Exception as error:
            logging.warning("Connection lost: %s; retrying in %ss", error, delay)
            await asyncio.sleep(delay)
            delay = min(delay * 2, 30)


async def main():
    board = LedBoard(PINS, MOCK_GPIO)
    try:
        await run(board)
    finally:
        board.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    with suppress(KeyboardInterrupt):
        asyncio.run(main())
