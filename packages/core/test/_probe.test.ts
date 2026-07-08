import { test } from "node:test"
import assert from "node:assert/strict"
import { ping } from "../src/_probe.ts"
test("probe ts ext", () => assert.equal(ping(), "pong"))
