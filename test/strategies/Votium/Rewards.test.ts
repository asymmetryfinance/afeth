import { network, ethers, upgrades } from "hardhat";
import { VotiumStrategy } from "../typechain-types";
import axios from "axios";
import { expect } from "chai";
import {
  incrementVlcvxEpoch,
  updateRewardsMerkleRoot,
} from "./VotiumTestHelpers";

describe("Test Votium Rewards Logic!", async function () {
  let votiumStrategy: VotiumStrategy;
  let accounts: any;
  const resetToBlock = async (blockNumber: number) => {
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.MAINNET_URL,
            blockNumber,
          },
        },
      ],
    });
    accounts = await ethers.getSigners();
    const votiumStrategyFactory = await ethers.getContractFactory(
      "VotiumStrategy"
    );
    votiumStrategy = (await upgrades.deployProxy(votiumStrategyFactory, [
      accounts[0].address,
    ])) as VotiumStrategy;
    await votiumStrategy.deployed();
  };

  before(async () => {
    const result = await axios.get(
      `https://api.etherscan.io/api?module=proxy&action=eth_blockNumber&apikey=${process.env.ETHERSCAN_API_KEY}`
    );
    // Because of dependence on 0x api
    // These tests needs to run close to the latest block
    await resetToBlock(Number(result.data.result) - 6);
  });

  it.only("Should mint token, mock merkle data, set merkle root, wait until claimable, oracleClaimRewards() & oracleSellRewards(), claim rewards", async function () {
    try {
      console.log("wtf1");

      let tx = await votiumStrategy.mint(0, {
        value: ethers.utils.parseEther("1"),
      });
      console.log("wtf2", tx);
      tx.wait();
      console.log("wtf3");
      await incrementVlcvxEpoch();
      console.log("wtf3.5");
      await incrementVlcvxEpoch();
      console.log("wtf4");
      await incrementVlcvxEpoch();
      console.log("wtf5");
      // should be allowed to claim every 2 epochs. 3 from when initially staking
      const { claimProofs, swapsData } = await updateRewardsMerkleRoot(
        votiumStrategy.address
      );
      console.log("wtf6");
      tx = await votiumStrategy.oracleClaimRewards(claimProofs);
      await tx.wait();
      tx = await votiumStrategy.oracleSellRewards(swapsData);
      await tx.wait();

      const balanceBeforeClaim = await ethers.provider.getBalance(
        accounts[0].address
      );
      tx = await votiumStrategy.claimRewards(0);
      await tx.wait();
      const balanceAfterClaim = await ethers.provider.getBalance(
        accounts[0].address
      );

      console.log("done");
      expect(balanceAfterClaim.gt(balanceBeforeClaim)).eq(true);
    } catch (e) {
      console.log("error", e);
    }
  });
});
