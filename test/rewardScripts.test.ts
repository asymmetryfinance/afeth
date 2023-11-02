import { expect } from "chai";
import {
  get0xSwapData,
  getProofsFromVotiumGithub,
} from "../scripts/generateClaimRewardsData";
import { ethers, network } from "hardhat";
import { oldVotiumAbi } from "./abis/oldVotiumAbi"; // TODO once we upgrade on mainnet we dont need this here
import { afEthAbi } from "./abis/afEthAbi";
import { AfEth } from "../typechain-types";

// this should stay skipped because we dont want it pulling votium repo on ci
// its good enough to test locally
describe.skip("Test Reward Scripts", async function () {
  it("Test the scripts", async function () {
    const accounts = await ethers.getSigners();
    const rewarderAddress = await new ethers.Contract(
      "0xb5D336912EB99d0eA05F499172F39768afab8D4b",
      oldVotiumAbi,
      accounts[0]
    ).rewarder();
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [rewarderAddress],
    });
    const impersonatedRewarderSigner = await ethers.getSigner(rewarderAddress);

    // send impersonated owner some eth
    let tx = await accounts[0].sendTransaction({
      to: rewarderAddress,
      value: "2000000000000000000", // 2 eth
    });
    await tx.wait();

    const votiumStrategy = new ethers.Contract(
      "0xb5D336912EB99d0eA05F499172F39768afab8D4b",
      oldVotiumAbi,
      impersonatedRewarderSigner
    );

    const afEth = new ethers.Contract(
      "0x5F10B16F0959AaC2E33bEdc9b0A4229Bb9a83590",
      afEthAbi,
      accounts[0]
    ) as AfEth;

    const proofs = await getProofsFromVotiumGithub();
    console.log("proofs", proofs);

    const claimTx = await votiumStrategy.claimRewards(proofs);
    await claimTx.wait();

    console.log("rewards claimed, now generating swap data");

    // now sell the rewards and apply them

    const swapsData = await get0xSwapData(proofs);

    const priceBefore = await afEth.price(true);

    tx = await votiumStrategy.applyRewards(swapsData, 0, 0);
    await tx.wait();

    const priceAfter = await afEth.price(true);

    expect(priceBefore).lt(priceAfter);
  });
});
