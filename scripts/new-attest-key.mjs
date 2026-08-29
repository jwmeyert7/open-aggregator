// One-time helper: prints a fresh private key and its address for the
// attestation hot wallet. Run `node scripts/new-attest-key.mjs`, put the key
// in Vercel as ATTEST_PRIVATE_KEY (production), and send the address a few
// dollars of ETH on Base for gas. The key should never hold more than that.
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const key = generatePrivateKey();
console.log("ATTEST_PRIVATE_KEY =", key);
console.log("address (fund with ~$3 of Base ETH):", privateKeyToAccount(key).address);
