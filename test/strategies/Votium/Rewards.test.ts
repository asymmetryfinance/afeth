import { network, ethers, upgrades } from "hardhat";
import { VotiumStrategy } from "../typechain-types";
import {
  incrementVlcvxEpoch,
  readJSONFromFile,
  updateRewardsMerkleRoot,
} from "./VotiumTestHelpers";
import { expect } from "chai";

describe("Test Votium Rewards Logic", async function () {
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

  before(
    async () => await resetToBlock(parseInt(process.env.BLOCK_NUMBER ?? "0"))
  );

  it("Should mint token, mock merkle data, set merkle root, wait until claimable, oracleClaimRewards() & oracleSellRewards(), claim rewards", async function () {
    let tx = await votiumStrategy.mint(0, {
      value: ethers.utils.parseEther("1"),
    });
    tx.wait();
    await incrementVlcvxEpoch();
    await incrementVlcvxEpoch();
    await incrementVlcvxEpoch();

    const testData = await readJSONFromFile("./scripts/testData.json");

    // should be allowed to claim every 2 epochs. 3 from when initially staking
    await updateRewardsMerkleRoot(
      testData.merkleRoots,
      testData.swapsData.map((sd: any) => sd.sellToken)
    );

    const claimProofs = testData.claimProofs;
    tx = await votiumStrategy.oracleClaimRewards(claimProofs);
    await tx.wait();
    // sell rewards
    const swapsData = testData.swapsData;
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

    expect(balanceAfterClaim.gt(balanceBeforeClaim)).eq(true);
  });
});
