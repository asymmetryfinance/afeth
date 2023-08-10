import { ethers, network, upgrades } from "hardhat";
import { VotiumStrategy } from "../typechain-types";
import { expect } from "chai";
import { BigNumber } from "ethers";
import {
  getCurrentEpoch,
  incrementEpochCallOracles,
} from "./VotiumTestHelpers";

describe("Test Votium Cvx Lock & Unlock Logic", async function () {
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

  beforeEach(
    async () => await resetToBlock(parseInt(process.env.BLOCK_NUMBER ?? "0"))
  );

  it("Should fail to burn if requestClose() has not been called", async function () {
    const mintTx = await votiumStrategy.mint(0, {
      value: ethers.utils.parseEther("1"),
    });
    await mintTx.wait();

    await expect(votiumStrategy.burn(0)).to.be.revertedWith(
      "requestClose() not called"
    );
  });

  it("Should fail to burn if less than 17 epochs have passed since minting", async function () {
    const mintTx = await votiumStrategy.mint(0, {
      value: ethers.utils.parseEther("1"),
    });
    await mintTx.wait();

    await votiumStrategy.requestClose(0);

    for (let i = 0; i < 16; i++)
      await incrementEpochCallOracles(votiumStrategy);
    await expect(votiumStrategy.burn(0)).to.be.revertedWith("still locked");

    // should succeed after 1 more
    await incrementEpochCallOracles(votiumStrategy);
    await votiumStrategy.burn(0);
  });

  it("Should update values correctly if requestClose() is called followed by oracleRelockCvx() 17 weeks later", async function () {
    const mintTx = await votiumStrategy.mint(0, {
      value: ethers.utils.parseEther("1"),
    });
    await mintTx.wait();

    const unlockTime0 = (await votiumStrategy.positions(0)).unlockTime;

    expect(unlockTime0).eq(0);

    const requestCloseTx = await votiumStrategy.requestClose(0);
    await requestCloseTx.wait();

    const firstRelockEpoch = await votiumStrategy.lastEpochLocksProcessed();
    const unlockTimeFinal = (await votiumStrategy.positions(0)).unlockTime;

    // wait 16 epochs and try to relock
    for (let i = 0; i < 16; i++) {
      await incrementEpochCallOracles(votiumStrategy);
      const currentBlockTime = (await ethers.provider.getBlock()).timestamp;
      expect(currentBlockTime).lt(unlockTimeFinal);
    }

    await votiumStrategy.oracleRelockCvx();

    // 16 epochs isnt enough to be eligible to relock so it wont have relocked
    expect(await votiumStrategy.lastEpochLocksProcessed()).eq(firstRelockEpoch);

    expect(await votiumStrategy.cvxToLeaveUnlocked()).eq(0);

    // wait 1 more epoch and it will have unlocked so can be relocked
    await incrementEpochCallOracles(votiumStrategy);
    await votiumStrategy.oracleRelockCvx();

    const currentBlockTime = (await ethers.provider.getBlock()).timestamp;
    // now it should be eligible for relock because some is unlockable
    expect(currentBlockTime).gt(unlockTimeFinal);

    const lastEpochLocksProcessed =
      await votiumStrategy.lastEpochLocksProcessed();
    const currentEpoch = await getCurrentEpoch();

    expect(await votiumStrategy.cvxToLeaveUnlocked()).gt(0);

    expect(lastEpochLocksProcessed).eq(currentEpoch);
    expect(lastEpochLocksProcessed).eq(
      BigNumber.from(firstRelockEpoch).add(17)
    );
  });
});
