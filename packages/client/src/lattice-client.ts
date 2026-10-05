import { type VerifiedVolume, VolumeClient } from "@adalinxx/lattice-volumes";
import { type BlockView, type TransactionProjection } from "./models.js";
import { NodeClient } from "./node-client.js";

/** Composes the node's bounded read plane with the content service/DHT plane. */
export class LatticeClient {
  readonly node: NodeClient;
  readonly volumes: VolumeClient;

  constructor(node: NodeClient, volumes: VolumeClient) {
    this.node = node;
    this.volumes = volumes;
  }

  async latestBlock(signal?: AbortSignal): Promise<{
    readonly view: BlockView;
    readonly volume: VerifiedVolume;
  }> {
    const latest = await this.node.latestBlock(signal);
    return this.block(latest.hash, signal);
  }

  async block(
    id: string | bigint,
    signal?: AbortSignal,
  ): Promise<{ readonly view: BlockView; readonly volume: VerifiedVolume }> {
    const view = await this.node.block(id, signal);
    return { view, volume: await this.volumes.get(view.hash, signal) };
  }

  async postState(id: string | bigint, signal?: AbortSignal): Promise<VerifiedVolume> {
    const block = await this.node.block(id, signal);
    return this.volumes.get(block.postStateCID, signal);
  }

  async transactions(id: string | bigint, signal?: AbortSignal): Promise<VerifiedVolume> {
    const block = await this.node.block(id, signal);
    return this.volumes.get(block.transactionsCID, signal);
  }

  async transaction(
    cid: string,
    signal?: AbortSignal,
  ): Promise<{
    readonly projection: TransactionProjection;
    readonly transaction: VerifiedVolume;
    readonly body: VerifiedVolume;
  }> {
    const [projection, reference, transaction] = await Promise.all([
      this.node.transaction(cid, signal),
      this.node.transactionContent(cid, signal),
      this.volumes.get(cid, signal),
    ]);
    if (reference.cid !== cid)
      throw new Error(`node returned transaction ${reference.cid} for ${cid}`);
    return {
      projection,
      transaction,
      body: await this.volumes.get(reference.bodyCID, signal),
    };
  }
}
