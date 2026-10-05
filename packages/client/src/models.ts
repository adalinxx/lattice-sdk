import {
  array,
  decimal,
  integer,
  optionalBoolean,
  optionalDecimal,
  optionalString,
  record,
  string,
  stringArray,
} from "./wire.js";

export interface NodeStatus {
  readonly phase: string;
  readonly chainPath: readonly string[];
  readonly nexusGenesisCID: string;
  readonly tipCID?: string;
  readonly height?: bigint;
  readonly revision?: bigint;
  readonly mempoolCount: number;
  readonly mempoolBytes: number;
  readonly templateDigest?: string;
}

export function parseNodeStatus(value: unknown): NodeStatus {
  const body = record(value, "status");
  return {
    phase: string(body.phase, "status.phase"),
    chainPath: stringArray(body.chainPath, "status.chainPath"),
    nexusGenesisCID: string(body.nexusGenesisCID, "status.nexusGenesisCID"),
    ...(body.tipCID === undefined ? {} : { tipCID: string(body.tipCID, "status.tipCID") }),
    ...(body.height === undefined ? {} : { height: decimal(body.height, "status.height") }),
    ...(body.revision === undefined ? {} : { revision: decimal(body.revision, "status.revision") }),
    mempoolCount: integer(body.mempoolCount, "status.mempoolCount"),
    mempoolBytes: integer(body.mempoolBytes, "status.mempoolBytes"),
    ...(body.templateDigest === undefined
      ? {}
      : { templateDigest: string(body.templateDigest, "status.templateDigest") }),
  };
}

export interface BlockView {
  readonly height: bigint;
  readonly hash: string;
  readonly timestamp: bigint;
  readonly previousBlock?: string;
  readonly transactionCount: number;
  readonly childBlockCount: number;
  readonly nonce: bigint;
  readonly version: number;
  readonly target: string;
  readonly nextTarget: string;
  readonly transactionsCID: string;
  readonly postStateCID: string;
  readonly chain: readonly string[];
  readonly rewardRecipient?: string;
  readonly rewardCredited?: bigint;
}

export interface LatestBlockView {
  readonly height: bigint;
  readonly hash: string;
  readonly transactionCount: number;
  readonly timestamp: bigint;
  readonly previousBlock?: string;
  readonly rewardRecipient?: string;
  readonly rewardCredited?: bigint;
}

export function parseLatestBlock(value: unknown): LatestBlockView {
  const body = record(value, "latest block");
  const previousBlock = optionalString(body.previousBlock, "latestBlock.previousBlock");
  const rewardRecipient = optionalString(body.rewardRecipient, "latestBlock.rewardRecipient");
  const rewardCredited = optionalDecimal(body.rewardCredited, "latestBlock.rewardCredited");
  return {
    height: decimal(body.height, "latestBlock.height"),
    hash: string(body.hash, "latestBlock.hash"),
    transactionCount: integer(body.transactionCount, "latestBlock.transactionCount"),
    timestamp: decimal(body.timestamp, "latestBlock.timestamp"),
    ...(previousBlock === undefined ? {} : { previousBlock }),
    ...(rewardRecipient === undefined ? {} : { rewardRecipient }),
    ...(rewardCredited === undefined ? {} : { rewardCredited }),
  };
}

export function parseBlock(value: unknown): BlockView {
  const body = record(value, "block");
  const previousBlock = optionalString(body.previousBlock, "block.previousBlock");
  const rewardRecipient = optionalString(body.rewardRecipient, "block.rewardRecipient");
  const rewardCredited = optionalDecimal(body.rewardCredited, "block.rewardCredited");
  return {
    height: decimal(body.height, "block.height"),
    hash: string(body.hash, "block.hash"),
    timestamp: decimal(body.timestamp, "block.timestamp"),
    ...(previousBlock === undefined ? {} : { previousBlock }),
    transactionCount: integer(body.transactionCount, "block.transactionCount"),
    childBlockCount: integer(body.childBlockCount, "block.childBlockCount"),
    nonce: decimal(body.nonce, "block.nonce"),
    version: integer(body.version, "block.version"),
    target: string(body.target, "block.target"),
    nextTarget: string(body.nextTarget, "block.nextTarget"),
    transactionsCID: string(body.transactionsCID, "block.transactionsCID"),
    postStateCID: string(body.postStateCID, "block.postStateCID"),
    chain: stringArray(body.chain, "block.chain"),
    ...(rewardRecipient === undefined ? {} : { rewardRecipient }),
    ...(rewardCredited === undefined ? {} : { rewardCredited }),
  };
}

export interface AccountState {
  readonly owner: string;
  readonly balance: bigint;
  readonly nonce: bigint;
}

export function parseAccount(value: unknown): AccountState {
  const body = record(value, "account");
  return {
    owner: string(body.owner, "account.owner"),
    balance: decimal(body.balance, "account.balance"),
    nonce: decimal(body.nonce, "account.nonce"),
  };
}

export interface TransactionProjection {
  readonly txCID: string;
  readonly blockHeight?: bigint;
  readonly blockHash?: string;
  readonly timestamp?: bigint;
  readonly nonce: bigint;
  readonly signers: readonly string[];
  readonly chainPath: readonly string[];
  readonly accountActions: readonly { readonly owner: string; readonly delta: bigint }[];
  readonly depositActions: readonly {
    readonly nonce: bigint;
    readonly demander: string;
    readonly amountDemanded: bigint;
    readonly amountDeposited: bigint;
  }[];
  readonly receiptActions: readonly {
    readonly withdrawer: string;
    readonly nonce: bigint;
    readonly demander: string;
    readonly amountDemanded: bigint;
    readonly directory: string;
  }[];
  readonly withdrawalActions: readonly {
    readonly withdrawer: string;
    readonly nonce: bigint;
    readonly demander: string;
    readonly amountDemanded: bigint;
    readonly amountWithdrawn: bigint;
  }[];
}

export function parseTransactionProjection(value: unknown): TransactionProjection {
  const body = record(value, "transaction");
  const blockHeight = optionalDecimal(body.blockHeight, "transaction.blockHeight");
  const blockHash = optionalString(body.blockHash, "transaction.blockHash");
  const timestamp = optionalDecimal(body.timestamp, "transaction.timestamp");
  return {
    txCID: string(body.txCID, "transaction.txCID"),
    ...(blockHeight === undefined ? {} : { blockHeight }),
    ...(blockHash === undefined ? {} : { blockHash }),
    ...(timestamp === undefined ? {} : { timestamp }),
    nonce: decimal(body.nonce, "transaction.nonce"),
    signers: stringArray(body.signers, "transaction.signers"),
    chainPath: stringArray(body.chainPath, "transaction.chainPath"),
    accountActions: array(body.accountActions, "transaction.accountActions", (entry, name) => {
      const action = record(entry, name);
      return {
        owner: string(action.owner, `${name}.owner`),
        delta: decimal(action.delta, `${name}.delta`),
      };
    }),
    depositActions: array(body.depositActions, "transaction.depositActions", (entry, name) => {
      const action = record(entry, name);
      return {
        nonce: decimal(action.nonce, `${name}.nonce`),
        demander: string(action.demander, `${name}.demander`),
        amountDemanded: decimal(action.amountDemanded, `${name}.amountDemanded`),
        amountDeposited: decimal(action.amountDeposited, `${name}.amountDeposited`),
      };
    }),
    receiptActions: array(body.receiptActions, "transaction.receiptActions", (entry, name) => {
      const action = record(entry, name);
      return {
        withdrawer: string(action.withdrawer, `${name}.withdrawer`),
        nonce: decimal(action.nonce, `${name}.nonce`),
        demander: string(action.demander, `${name}.demander`),
        amountDemanded: decimal(action.amountDemanded, `${name}.amountDemanded`),
        directory: string(action.directory, `${name}.directory`),
      };
    }),
    withdrawalActions: array(
      body.withdrawalActions,
      "transaction.withdrawalActions",
      (entry, name) => {
        const action = record(entry, name);
        return {
          withdrawer: string(action.withdrawer, `${name}.withdrawer`),
          nonce: decimal(action.nonce, `${name}.nonce`),
          demander: string(action.demander, `${name}.demander`),
          amountDemanded: decimal(action.amountDemanded, `${name}.amountDemanded`),
          amountWithdrawn: decimal(action.amountWithdrawn, `${name}.amountWithdrawn`),
        };
      },
    ),
  };
}

export interface ChainInfo {
  readonly genesisHash?: string;
  readonly height?: bigint;
  readonly tipCID?: string;
  readonly chain: readonly string[];
  /** This node's relay-policy fee floor; never consensus. */
  readonly minRelayFee?: bigint;
  /** Whether the answering listener accepts `POST /transactions`. */
  readonly acceptsSubmit?: boolean;
}

export function parseChainInfo(value: unknown): ChainInfo {
  const body = record(value, "chain info");
  const genesisHash = optionalString(body.genesisHash, "chainInfo.genesisHash");
  const height = optionalDecimal(body.height, "chainInfo.height");
  const tipCID = optionalString(body.tipCID, "chainInfo.tipCID");
  const minRelayFee = optionalDecimal(body.minRelayFee, "chainInfo.minRelayFee");
  const acceptsSubmit = optionalBoolean(body.acceptsSubmit, "chainInfo.acceptsSubmit");
  return {
    ...(genesisHash === undefined ? {} : { genesisHash }),
    ...(height === undefined ? {} : { height }),
    ...(tipCID === undefined ? {} : { tipCID }),
    chain: stringArray(body.chain, "chainInfo.chain"),
    ...(minRelayFee === undefined ? {} : { minRelayFee }),
    ...(acceptsSubmit === undefined ? {} : { acceptsSubmit }),
  };
}

/** One canonical block summary from `GET /api/blocks`; no `rewardCredited`. */
export interface BlockSummary {
  readonly height: bigint;
  readonly hash: string;
  readonly previousBlock?: string;
  readonly timestamp: bigint;
  readonly transactionCount: number;
  readonly rewardRecipient?: string;
}

export interface BlocksPage {
  readonly blocks: readonly BlockSummary[];
  /** Pass as the next page's `before`; absent once height 0 is listed. */
  readonly nextBefore?: bigint;
}

export function parseBlocksPage(value: unknown): BlocksPage {
  const body = record(value, "blocks page");
  const nextBefore = optionalDecimal(body.nextBefore, "blocks.nextBefore");
  return {
    blocks: array(body.blocks, "blocks.blocks", (entry, name) => {
      const row = record(entry, name);
      const previousBlock = optionalString(row.previousBlock, `${name}.previousBlock`);
      const rewardRecipient = optionalString(row.rewardRecipient, `${name}.rewardRecipient`);
      return {
        height: decimal(row.height, `${name}.height`),
        hash: string(row.hash, `${name}.hash`),
        ...(previousBlock === undefined ? {} : { previousBlock }),
        timestamp: decimal(row.timestamp, `${name}.timestamp`),
        transactionCount: integer(row.transactionCount, `${name}.transactionCount`),
        ...(rewardRecipient === undefined ? {} : { rewardRecipient }),
      };
    }),
    ...(nextBefore === undefined ? {} : { nextBefore }),
  };
}

/** A child commitment from `GET /api/block/:cid/children`. */
export interface BlockChild {
  readonly directory: string;
  readonly blockHash: string;
  /** Omitted when the answering node does not host that child chain. */
  readonly height?: bigint;
  readonly transactionCount?: number;
}

export function parseBlockChildren(value: unknown): BlockChild[] {
  const body = record(value, "block children");
  return array(body.children, "children", (entry, name) => {
    const child = record(entry, name);
    const height = optionalDecimal(child.height, `${name}.height`);
    return {
      directory: string(child.directory, `${name}.directory`),
      blockHash: string(child.blockHash, `${name}.blockHash`),
      ...(height === undefined ? {} : { height }),
      ...(child.transactionCount === undefined
        ? {}
        : { transactionCount: integer(child.transactionCount, `${name}.transactionCount`) }),
    };
  });
}
