import {
  votiumClaimRewards,
  votiumSellRewards,
} from "./applyVotiumRewardsHelpers";

const votiumStrategyAddress = "0xbbba116ef0525cd5ea9f4a9c1f628c3bfc343261";

(async function main() {
  const proofs = await votiumClaimRewards(votiumStrategyAddress);
  await votiumSellRewards(votiumStrategyAddress, proofs);
})()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
