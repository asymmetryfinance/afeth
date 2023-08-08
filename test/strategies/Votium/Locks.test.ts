import { ethers, upgrades } from "hardhat";
import { VotiumStrategy } from "../typechain-types";
import { expect } from "chai";
import { vlCvxAbi } from "../../abis/vlCvxAbi";
import { BigNumber } from "ethers";
import { incrementVlcvxEpoch } from "./VotiumTestHelpers";

describe("Test Votium Cvx Lock & Unlock Logic", async function () {
  let votiumStrategy: any;
  let accounts: any;

  before(async () => {
    accounts = await ethers.getSigners();

    const votiumStrategyFactory = await ethers.getContractFactory(
      "VotiumStrategy"
    );
    votiumStrategy = (await upgrades.deployProxy(votiumStrategyFactory, [
      accounts[0].address,
    ])) as VotiumStrategy;
    await votiumStrategy.deployed();
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
      await incrementVlcvxEpoch();
      const currentBlockTime = (await ethers.provider.getBlock()).timestamp;
      expect(currentBlockTime).lt(unlockTimeFinal);
    }

    await oracleRelockCvx();

    // 16 epochs isnt enough to be eligible to relock so it wont have relocked
    expect(await votiumStrategy.lastEpochLocksProcessed()).eq(firstRelockEpoch);

    expect(await votiumStrategy.cvxToLeaveUnlocked()).eq(0);

    // wait 1 more epoch and it will have unlocked so can be relocked
    await incrementVlcvxEpoch();
    await oracleRelockCvx();

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

  const getCurrentEpoch = async () => {
    const accounts = await ethers.getSigners();
    const vlCvxContract = new ethers.Contract(
      "0x72a19342e8F1838460eBFCCEf09F6585e32db86E",
      vlCvxAbi,
      accounts[0]
    );
    return vlCvxContract.findEpochId(await getCurrentBlockTime());
  };

  const getCurrentBlockTime = async () => {
    const currentBlock = await ethers.provider.getBlock("latest");
    return currentBlock.timestamp;
  };

  const oracleRelockCvx = async () => {
    await votiumStrategy.oracleRelockCvx();
  };
});
