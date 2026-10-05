import { addressFromMultikey } from "./address.js";
import { cidV1DagCbor } from "./cid.js";
import { type DagCborValue, encodeDagCbor } from "./dag-cbor.js";
import { encodeEd25519Multikey } from "./multikey.js";
import { publicKeyFromPrivate, signPreimage } from "./signing.js";
import { utf8 } from "./bytes.js";

export interface AccountAction {
  readonly owner: string;
  readonly delta: bigint;
}

export interface Action {
  readonly key: string;
  readonly oldValue?: string;
  readonly newValue?: string;
}

export interface DepositAction {
  readonly nonce: bigint;
  readonly demander: string;
  readonly amountDemanded: bigint;
  readonly amountDeposited: bigint;
}

export interface ReceiptAction {
  readonly withdrawer: string;
  readonly nonce: bigint;
  readonly demander: string;
  readonly amountDemanded: bigint;
  readonly directory: string;
}

export interface WithdrawalAction {
  readonly withdrawer: string;
  readonly nonce: bigint;
  readonly demander: string;
  readonly amountDemanded: bigint;
  readonly amountWithdrawn: bigint;
}

export interface TransactionBody {
  readonly accountActions: readonly AccountAction[];
  readonly actions: readonly Action[];
  readonly depositActions: readonly DepositAction[];
  readonly receiptActions: readonly ReceiptAction[];
  readonly withdrawalActions: readonly WithdrawalAction[];
  readonly signers: readonly string[];
  readonly nonce: bigint;
  readonly chainPath: readonly string[];
}

export interface TransactionPayload {
  readonly transaction: {
    readonly signatures: Readonly<Record<string, string>>;
    readonly body: WireTransactionBody;
  };
}

export interface WireTransactionBody {
  readonly accountActions: readonly { readonly owner: string; readonly delta: string }[];
  readonly actions: readonly Action[];
  readonly depositActions: readonly {
    readonly nonce: string;
    readonly demander: string;
    readonly amountDemanded: string;
    readonly amountDeposited: string;
  }[];
  readonly receiptActions: readonly {
    readonly withdrawer: string;
    readonly nonce: string;
    readonly demander: string;
    readonly amountDemanded: string;
    readonly directory: string;
  }[];
  readonly withdrawalActions: readonly {
    readonly withdrawer: string;
    readonly nonce: string;
    readonly demander: string;
    readonly amountDemanded: string;
    readonly amountWithdrawn: string;
  }[];
  readonly signers: readonly string[];
  readonly nonce: string;
  readonly chainPath: readonly string[];
}

const INT64_MIN = -(1n << 63n);
const INT64_MAX = (1n << 63n) - 1n;
const UINT64_MAX = (1n << 64n) - 1n;
const UINT128_MAX = (1n << 128n) - 1n;

function assertRange(name: string, value: bigint, minimum: bigint, maximum: bigint): void {
  if (value < minimum || value > maximum) throw new Error(`${name} is out of range`);
}

function assertBody(body: TransactionBody): void {
  assertRange("transaction nonce", body.nonce, 0n, UINT64_MAX);
  if (body.chainPath.length === 0 || body.chainPath.some((part) => part.length === 0)) {
    throw new Error("chainPath must contain non-empty components");
  }
  for (const action of body.accountActions) {
    assertRange("account delta", action.delta, INT64_MIN, INT64_MAX);
  }
  for (const action of [
    ...body.depositActions,
    ...body.receiptActions,
    ...body.withdrawalActions,
  ]) {
    assertRange("cross-chain nonce", action.nonce, 0n, UINT128_MAX);
    // cashew's current canonical DAG-CBOR encoder accepts UInt128 values only
    // through UInt64.max. Keep the sharper error here at the SDK boundary.
    assertRange("encodable cross-chain nonce", action.nonce, 0n, UINT64_MAX);
    assertRange("amount demanded", action.amountDemanded, 0n, UINT64_MAX);
  }
  for (const action of body.depositActions) {
    assertRange("amount deposited", action.amountDeposited, 0n, UINT64_MAX);
  }
  for (const action of body.withdrawalActions) {
    assertRange("amount withdrawn", action.amountWithdrawn, 0n, UINT64_MAX);
  }
}

function actionValue(action: Action): DagCborValue {
  const output: Record<string, DagCborValue> = { key: action.key };
  if (action.oldValue !== undefined) output.oldValue = action.oldValue;
  if (action.newValue !== undefined) output.newValue = action.newValue;
  return output;
}

function bodyValue(body: TransactionBody): DagCborValue {
  assertBody(body);
  return {
    accountActions: body.accountActions.map((action) => ({
      owner: action.owner,
      delta: action.delta,
    })),
    actions: body.actions.map(actionValue),
    depositActions: body.depositActions.map((action) => ({
      nonce: action.nonce,
      demander: action.demander,
      amountDemanded: action.amountDemanded,
      amountDeposited: action.amountDeposited,
    })),
    receiptActions: body.receiptActions.map((action) => ({
      withdrawer: action.withdrawer,
      nonce: action.nonce,
      demander: action.demander,
      amountDemanded: action.amountDemanded,
      directory: action.directory,
    })),
    withdrawalActions: body.withdrawalActions.map((action) => ({
      withdrawer: action.withdrawer,
      nonce: action.nonce,
      demander: action.demander,
      amountDemanded: action.amountDemanded,
      amountWithdrawn: action.amountWithdrawn,
    })),
    signers: [...body.signers],
    nonce: body.nonce,
    chainPath: [...body.chainPath],
  };
}

export function encodeTransactionBody(body: TransactionBody): {
  readonly bytes: Uint8Array;
  readonly cid: string;
} {
  const bytes = encodeDagCbor(bodyValue(body));
  return { bytes, cid: cidV1DagCbor(bytes) };
}

export function transactionSigningPreimage(
  bodyCID: string,
  chainPath: readonly string[],
  nonce: bigint,
): string {
  const lines = ["domain:13:lattice-tx-v1", `chainPath.count:${chainPath.length}`];
  for (const component of chainPath) {
    lines.push(`chainPath.component:${utf8(component).length}:${component}`);
  }
  lines.push(`nonce:${nonce}`, `bodyCID:${utf8(bodyCID).length}:${bodyCID}`);
  return lines.join("\n");
}

export function toWireTransactionBody(body: TransactionBody): WireTransactionBody {
  assertBody(body);
  return {
    accountActions: body.accountActions.map(({ owner, delta }) => ({
      owner,
      delta: delta.toString(),
    })),
    actions: body.actions.map((action) => ({ ...action })),
    depositActions: body.depositActions.map((action) => ({
      ...action,
      nonce: action.nonce.toString(),
      amountDemanded: action.amountDemanded.toString(),
      amountDeposited: action.amountDeposited.toString(),
    })),
    receiptActions: body.receiptActions.map((action) => ({
      ...action,
      nonce: action.nonce.toString(),
      amountDemanded: action.amountDemanded.toString(),
    })),
    withdrawalActions: body.withdrawalActions.map((action) => ({
      ...action,
      nonce: action.nonce.toString(),
      amountDemanded: action.amountDemanded.toString(),
      amountWithdrawn: action.amountWithdrawn.toString(),
    })),
    signers: [...body.signers],
    nonce: body.nonce.toString(),
    chainPath: [...body.chainPath],
  };
}

export function transactionPayload(
  signatures: Readonly<Record<string, string>>,
  body: TransactionBody,
): TransactionPayload {
  return { transaction: { signatures: { ...signatures }, body: toWireTransactionBody(body) } };
}

export function signTransactionBody(
  body: TransactionBody,
  privateKey: Uint8Array,
): { readonly bodyCID: string; readonly publicKey: string; readonly signature: string } {
  const publicKey = encodeEd25519Multikey(publicKeyFromPrivate(privateKey));
  const { cid } = encodeTransactionBody(body);
  return {
    bodyCID: cid,
    publicKey,
    signature: signPreimage(
      transactionSigningPreimage(cid, body.chainPath, body.nonce),
      privateKey,
    ),
  };
}

export function buildTransfer(args: {
  readonly from: string;
  readonly to: string;
  readonly amount: bigint;
  readonly fee: bigint;
  readonly nonce: bigint;
  readonly chainPath: readonly string[];
}): TransactionBody {
  const { from, to, amount, fee, nonce, chainPath } = args;
  if (amount <= 0n) throw new Error("amount must be positive");
  if (fee < 0n) throw new Error("fee must not be negative");
  if (amount + fee > INT64_MAX) throw new Error("amount plus fee is too large");
  if (from === to) throw new Error("sender and recipient must differ");
  return {
    accountActions: [
      { owner: from, delta: -(amount + fee) },
      { owner: to, delta: amount },
    ],
    actions: [],
    depositActions: [],
    receiptActions: [],
    withdrawalActions: [],
    signers: [from],
    nonce,
    chainPath: [...chainPath],
  };
}

export function accountFromPrivateKey(privateKey: Uint8Array): {
  readonly privateKey: Uint8Array;
  readonly publicKey: string;
  readonly address: string;
} {
  const publicKey = encodeEd25519Multikey(publicKeyFromPrivate(privateKey));
  return { privateKey: privateKey.slice(), publicKey, address: addressFromMultikey(publicKey) };
}
