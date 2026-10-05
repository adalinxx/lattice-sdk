import assert from "node:assert/strict";
import { test } from "node:test";

import { buildTransfer, transactionPayload, type TransactionPayload } from "@adalinxx/lattice-core";
import { HTTPTransactionSubmitter } from "@adalinxx/lattice-relay";

test("submission is explicit and preserves integers as decimal strings", async () => {
  let submitted: TransactionPayload | undefined;
  const fetch = async (_input: string | URL, init?: RequestInit): Promise<Response> => {
    submitted = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ transactionCID: "bafytransaction" }), { status: 200 });
  };
  const body = buildTransfer({
    from: "alice",
    to: "bob",
    amount: 9_007_199_254_740_993n,
    fee: 1n,
    nonce: 9_007_199_254_740_993n,
    chainPath: ["Nexus"],
  });
  const payload = transactionPayload({ ed01: "signature" }, body);
  const submitter = new HTTPTransactionSubmitter("https://relay.example.org/transactions", {
    fetch,
  });
  assert.equal((await submitter.submit(payload)).transactionCID, "bafytransaction");
  assert.equal(submitted?.transaction.body.nonce, "9007199254740993");
  assert.equal(submitted?.transaction.body.accountActions[0]?.delta, "-9007199254740994");
});

test("a relay endpoint must be explicitly secure or loopback", () => {
  assert.throws(
    () => new HTTPTransactionSubmitter("http://relay.example.org/transactions"),
    /must use HTTPS/,
  );
  assert.doesNotThrow(() => new HTTPTransactionSubmitter("http://localhost:8080/transactions"));
});
