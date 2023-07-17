import { ethers, network } from "hardhat";
import { VotiumPosition } from "../typechain-types";
import ERC20 from "@openzeppelin/contracts/build/contracts/ERC20.json";
import { expect } from "chai";
import axios from "axios";
describe("VotiumPosition", async function () {
  let votiumMockForked: VotiumPosition; // existing mock from forked mainnet

  before(async () => {
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.MAINNET_URL,
            blockNumber: Number(process.env.BLOCK_NUMBER),
          },
        },
      ],
    });
    const VotiumMockInterface = (
      await ethers.getContractFactory("VotiumPosition")
    ).interface as any;

    const forkedMockOwner = "0x8a65ac0e23f31979db06ec62af62b132a6df4741";

    // give forked mock owner some eth for txs
    const accounts = await ethers.getSigners();
    const tx = await accounts[0].sendTransaction({
      to: forkedMockOwner,
      value: "2000000000000000000", // 2 eth
    });
    await tx.wait();

    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [forkedMockOwner],
    });
    const forkedOwnerSigner = await ethers.getSigner(forkedMockOwner);
    votiumMockForked = new ethers.Contract(
      "0xbbba116ef0525cd5ea9f4a9c1f628c3bfc343261", // mainnet deployed votium mock thats now eligible to claim rewards
      VotiumMockInterface,
      forkedOwnerSigner
    ) as VotiumPosition;
  });

  it("Should call claimVotiumRewards() and succeed with the correct proof", async function () {
    const { data: proofs } = await axios.get(
      "https://merkle-api-production.up.railway.app/proof/0xbbba116ef0525cd5ea9f4a9c1f628c3bfc343261"
    );

    const balancesBefore = await getRewardBalances(proofs);
    const tx = await votiumMockForked.claimVotiumRewards(proofs as any);
    await tx.wait();
    const balancesAfter = await getRewardBalances(proofs);

    // TODO confirm token before and after balances;
    await getRewardBalances(proofs);

    // check that balances before are greater than balances after
    for (let i = 0; i < balancesBefore.length; i++) {
      expect(balancesAfter[i].gt(balancesBefore[i]));
    }
  });

  const getRewardBalances = async (proofs: any) => {
    const accounts = await ethers.getSigners();
    const balances = [];
    for (let i = 0; i < proofs.length; i++) {
      const proof = proofs[i];
      const token = proof[0];
      const tokenContract = new ethers.Contract(token, ERC20.abi, accounts[0]);
      const balance = await tokenContract.balanceOf(votiumMockForked.address);
      balances.push(balance);
    }
    return balances;
  };
});
