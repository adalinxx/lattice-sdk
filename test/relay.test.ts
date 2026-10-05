import assert from "node:assert/strict";
import { test } from "node:test";

import { buildTransfer, transactionPayload, type TransactionPayload } from "@adalinxx/lattice-core";
import {
  HTTPTransactionSubmitter,
  SUBMISSION_REFUSALS,
  SubmissionError,
} from "@adalinxx/lattice-relay";

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

test("the submitter posts exactly the node's POST /transactions shape", async () => {
  let request: { url: string; init?: RequestInit } | undefined;
  const fetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    request = { url: String(input), ...(init === undefined ? {} : { init }) };
    return new Response(
      JSON.stringify({ transactionCID: "bafytx", mempoolCount: 4, mempoolBytes: 2600 }),
    );
  };
  const body = buildTransfer({
    from: "alice",
    to: "bob",
    amount: 10n,
    fee: 2n,
    nonce: 0n,
    chainPath: ["Nexus", "Alpha"],
  });
  const submitter = new HTTPTransactionSubmitter("https://relay.example.org/transactions", {
    fetch,
  });
  assert.deepEqual(await submitter.submit(transactionPayload({ ed01key: "sig" }, body)), {
    transactionCID: "bafytx",
    mempoolCount: 4,
    mempoolBytes: 2600,
  });
  assert.equal(request?.url, "https://relay.example.org/transactions");
  assert.equal(request?.init?.method, "POST");
  assert.deepEqual(request?.init?.headers, {
    Accept: "application/json",
    "Content-Type": "application/json",
  });
  assert.deepEqual(JSON.parse(String(request?.init?.body)), {
    transaction: {
      signatures: { ed01key: "sig" },
      body: {
        accountActions: [
          { owner: "alice", delta: "-12" },
          { owner: "bob", delta: "10" },
        ],
        actions: [],
        depositActions: [],
        receiptActions: [],
        withdrawalActions: [],
        signers: ["alice"],
        nonce: "0",
        chainPath: ["Nexus", "Alpha"],
      },
    },
  });
});

test("named node refusals surface as typed submission errors", async () => {
  const refusing = (status: number, body: string) =>
    new HTTPTransactionSubmitter("https://relay.example.org/transactions", {
      fetch: async () => new Response(body, { status }),
    });
  const payload = transactionPayload(
    {},
    buildTransfer({ from: "a", to: "b", amount: 1n, fee: 0n, nonce: 0n, chainPath: ["Nexus"] }),
  );
  for (const [status, name] of [
    [400, "belowMinRelayFee"],
    [400, "feeTooLow"],
    [404, "unknownChain"],
    [429, "full"],
  ] as const) {
    // Hummingbird's JSON error envelope, as the node sends it.
    const error = await refusing(status, JSON.stringify({ error: { message: name } }))
      .submit(payload)
      .catch((caught: unknown) => caught);
    assert.ok(error instanceof SubmissionError);
    assert.equal(error.status, status);
    assert.equal(error.refusal, name);
    assert.equal(error.reason, name);
  }
  assert.ok(SUBMISSION_REFUSALS.includes("belowMinRelayFee"));

  const unnamed = await refusing(400, JSON.stringify({ error: { message: "something new" } }))
    .submit(payload)
    .catch((caught: unknown) => caught);
  assert.ok(unnamed instanceof SubmissionError);
  assert.equal(unnamed.refusal, "something new");
  assert.equal(unnamed.reason, undefined);

  // Public submit off: a bare 404 is a refusal by status, not an encoding fault.
  const off = await refusing(404, "")
    .submit(payload)
    .catch((caught: unknown) => caught);
  assert.ok(off instanceof SubmissionError);
  assert.equal(off.status, 404);
  assert.equal(off.refusal, undefined);
});
