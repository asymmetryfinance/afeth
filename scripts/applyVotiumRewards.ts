import { ethers } from "hardhat";
import {
  votiumClaimRewards,
  votiumSellRewards,
} from "./applyVotiumRewardsHelpers";

const votiumStrategyAddress = "0xbbba116ef0525cd5ea9f4a9c1f628c3bfc343261";

(async function main() {
  const accounts = await ethers.getSigners();
  const proofs = await votiumClaimRewards(accounts[0], votiumStrategyAddress);
  await votiumSellRewards(
    accounts[0],
    votiumStrategyAddress,
    proofs,
    undefined,
    false
  );
})()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
