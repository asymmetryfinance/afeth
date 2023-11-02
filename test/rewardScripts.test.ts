import { expect } from "chai";
import { getProofsFromVotiumGithub } from "../scripts/generateClaimRewardsData";
import { ethers, network } from "hardhat";
import { VotiumStrategy } from "../typechain-types";

describe.only("Test Reward Scripts", async function () {
  it("Test the scripts", async function () {
    const VotiumInterface = (await ethers.getContractFactory("VotiumStrategy"))
      .interface as any;
    const accounts = await ethers.getSigners();
    const rewarderAddress = await (
      new ethers.Contract(
        "0xb5D336912EB99d0eA05F499172F39768afab8D4b",
        VotiumInterface,
        accounts[0]
      ) as VotiumStrategy
    ).rewarder();
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [rewarderAddress],
    });
    const impersonatedRewarderSigner = await ethers.getSigner(rewarderAddress);

    // send impersonated owner some eth
    const tx = await accounts[0].sendTransaction({
      to: rewarderAddress,
      value: "2000000000000000000", // 2 eth
    });
    await tx.wait();

    const votiumStrategy = new ethers.Contract(
      "0xb5D336912EB99d0eA05F499172F39768afab8D4b",
      VotiumInterface,
      impersonatedRewarderSigner
    ) as VotiumStrategy;

    const proofs = await getProofsFromVotiumGithub();
    console.log("proofs", proofs);

    const claimTx = await votiumStrategy.claimRewards(proofs);
    await claimTx.wait();

    expect(true).eq(true);
  });
});
