import { network, ethers, upgrades } from "hardhat";
import { VotiumStrategy } from "../typechain-types";
import axios from "axios";
import { expect } from "chai";
import {
  generate0xSwapData,
  incrementVlcvxEpoch,
  updateRewardsMerkleRoot,
} from "./VotiumTestHelpers";

describe("Test Votium Rewards Logic", async function () {
  let votiumStrategy: VotiumStrategy;
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
    const accounts = await ethers.getSigners();
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

  it("Should mock merkle data, impersonate account to set merkle root, wait until claimable, claimRewards & sellRewards into eth", async function () {
    let tx = await votiumStrategy.mint(0, {
      value: ethers.utils.parseEther("1"),
    });
    tx.wait();
    await incrementVlcvxEpoch();
    await incrementVlcvxEpoch();
    // should be allowed to claim every 2 epochs
    const claimProofs = await updateRewardsMerkleRoot(votiumStrategy.address);
    tx = await votiumStrategy.oracleClaimRewards(claimProofs);
    await tx.wait();
    const tokenAddresses = claimProofs.map((cp: any[]) => cp[0]);
    const tokenAmounts = claimProofs.map((cp: any[]) => cp[2]);
    // sell rewards
    const swapsData = await generate0xSwapData(tokenAddresses, tokenAmounts);
    const ethBalanceBefore = await ethers.provider.getBalance(
      votiumStrategy.address
    );
    tx = await votiumStrategy.oracleSellRewards(swapsData);
    await tx.wait();
    const ethBalanceAfter = await ethers.provider.getBalance(
      votiumStrategy.address
    );
    expect(ethBalanceAfter).gt(ethBalanceBefore as any);
  });
});
