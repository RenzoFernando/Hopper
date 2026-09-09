import test from "node:test";
import assert from "node:assert/strict";
import { isCompleteRoomCode, normalizeRoomCode } from "../js/room-code.js";

test("normaliza códigos de sala como dos letras, guion fijo y cuatro números", () => {
  assert.equal(normalizeRoomCode("r"), "R");
  assert.equal(normalizeRoomCode("r4"), "R");
  assert.equal(normalizeRoomCode("rx"), "RX-");
  assert.equal(normalizeRoomCode("rx4"), "RX-4");
  assert.equal(normalizeRoomCode("rx-4821"), "RX-4821");
  assert.equal(normalizeRoomCode("rX48a21"), "RX-4821");
  assert.equal(normalizeRoomCode("12rx4821"), "RX-4821");
  assert.equal(normalizeRoomCode("rx482199"), "RX-4821");
});

test("solo considera completo el formato AA-1234", () => {
  assert.equal(isCompleteRoomCode("RX-4821"), true);
  assert.equal(isCompleteRoomCode("rx4821"), true);
  assert.equal(isCompleteRoomCode("R-4821"), false);
  assert.equal(isCompleteRoomCode("RX-48A1"), false);
  assert.equal(isCompleteRoomCode("12-4821"), false);
});
