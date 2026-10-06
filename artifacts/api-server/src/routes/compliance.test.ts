import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { GetComplianceStatusResponse } from "@workspace/api-zod";
import complianceRouter from "./compliance";

test("public compliance route serves contract-valid launch controls without caching", async () => {
  const app = express();
  app.use("/api", complianceRouter);
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/compliance/status`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = GetComplianceStatusResponse.parse(await response.json());
    assert.equal(body.launchControls.length, 8);
    assert.equal(new Set(body.launchControls.map((control) => control.id)).size, 8);
    assert.equal(body.paidPlayEnabled, body.launchControls.every((control) => control.status === "ready"));
    assert.ok(body.launchControls.every((control) => control.explanation.length > 0));
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});