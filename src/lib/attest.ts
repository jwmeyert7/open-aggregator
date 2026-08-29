import { createPublicClient, createWalletClient, decodeEventLog, encodeAbiParameters, encodePacked, http, keccak256, zeroAddress, zeroHash } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

/**
 * One EAS attestation per frozen edition, on Base: "this content hash existed
 * on this date", recorded somewhere the site cannot edit. This is what turns
 * the stored contentHash from an integrity check into a historical proof, and
 * what a collectible edition would later cite.
 *
 * EAS lives at the OP-stack predeploy addresses on Base (verified live:
 * both carry code and answer version() with 1.0.1). The schema registers
 * itself on first use, so the only setup is ATTEST_PRIVATE_KEY in the env, a
 * dedicated hot key holding a few dollars of Base ETH for gas. That key can
 * do nothing but spend its own dust on attestations, which is the accepted
 * tradeoff for automating a daily onchain write; keep its balance small.
 */
const EAS_ADDRESS = "0x4200000000000000000000000000000000000021" as const;
const SCHEMA_REGISTRY_ADDRESS = "0x4200000000000000000000000000000000000020" as const;
const SCHEMA = "string edition,bytes32 contentHash";

/** Deterministic EAS schema UID: keccak256(schema ++ resolver ++ revocable). */
const SCHEMA_UID = keccak256(encodePacked(["string", "address", "bool"], [SCHEMA, zeroAddress, false]));

const REGISTRY_ABI = [
  {
    type: "function",
    name: "getSchema",
    stateMutability: "view",
    inputs: [{ name: "uid", type: "bytes32" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "uid", type: "bytes32" },
          { name: "resolver", type: "address" },
          { name: "revocable", type: "bool" },
          { name: "schema", type: "string" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [
      { name: "schema", type: "string" },
      { name: "resolver", type: "address" },
      { name: "revocable", type: "bool" },
    ],
    outputs: [{ type: "bytes32" }],
  },
] as const;

const EAS_ABI = [
  {
    type: "function",
    name: "attest",
    stateMutability: "payable",
    inputs: [
      {
        name: "request",
        type: "tuple",
        components: [
          { name: "schema", type: "bytes32" },
          {
            name: "data",
            type: "tuple",
            components: [
              { name: "recipient", type: "address" },
              { name: "expirationTime", type: "uint64" },
              { name: "revocable", type: "bool" },
              { name: "refUID", type: "bytes32" },
              { name: "data", type: "bytes" },
              { name: "value", type: "uint256" },
            ],
          },
        ],
      },
    ],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "event",
    name: "Attested",
    inputs: [
      { name: "recipient", type: "address", indexed: true },
      { name: "attester", type: "address", indexed: true },
      { name: "uid", type: "bytes32", indexed: false },
      { name: "schema", type: "bytes32", indexed: true },
    ],
  },
] as const;

export function attestAvailable(): boolean {
  return Boolean(process.env.ATTEST_PRIVATE_KEY);
}

function clients() {
  const account = privateKeyToAccount(process.env.ATTEST_PRIVATE_KEY as `0x${string}`);
  const transport = http(process.env.ATTEST_RPC_URL || "https://mainnet.base.org");
  return {
    account,
    pub: createPublicClient({ chain: base, transport }),
    wallet: createWalletClient({ account, chain: base, transport }),
  };
}

/**
 * Attests one frozen edition: {edition: "day:2026-08-28", contentHash}.
 * Registers the schema on first ever use (one-time, cents). Returns the
 * attestation UID, viewable at https://base.easscan.org/attestation/view/UID.
 * Throws on failure; callers treat that as a retryable note, never a blocker.
 */
export async function attestEdition(edition: string, contentHashHex: string): Promise<string> {
  const { account, pub, wallet } = clients();

  const existing = await pub.readContract({
    address: SCHEMA_REGISTRY_ADDRESS,
    abi: REGISTRY_ABI,
    functionName: "getSchema",
    args: [SCHEMA_UID],
  });
  if (existing.uid === zeroHash) {
    const hash = await wallet.writeContract({
      address: SCHEMA_REGISTRY_ADDRESS,
      abi: REGISTRY_ABI,
      functionName: "register",
      args: [SCHEMA, zeroAddress, false],
    });
    await pub.waitForTransactionReceipt({ hash });
  }

  const data = encodeAbiParameters(
    [
      { name: "edition", type: "string" },
      { name: "contentHash", type: "bytes32" },
    ],
    [edition, `0x${contentHashHex}` as `0x${string}`]
  );
  const txHash = await wallet.writeContract({
    address: EAS_ADDRESS,
    abi: EAS_ABI,
    functionName: "attest",
    args: [
      {
        schema: SCHEMA_UID,
        data: { recipient: zeroAddress, expirationTime: 0n, revocable: false, refUID: zeroHash, data, value: 0n },
      },
    ],
    account,
  });
  const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== EAS_ADDRESS.toLowerCase()) continue;
    try {
      const parsed = decodeEventLog({ abi: EAS_ABI, data: log.data, topics: log.topics });
      if (parsed.eventName === "Attested") return parsed.args.uid;
    } catch {
      // not the Attested event
    }
  }
  throw new Error(`attestation transaction ${txHash} mined but no Attested event found`);
}
