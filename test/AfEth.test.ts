import { ethers, upgrades } from "hardhat";
import { AfEth, SafEthStrategy, VotiumStrategy } from "../typechain-types";
import { expect } from "chai";

describe("Test AfEth (Votium + SafEth Strategies)", async function () {
  let afEthManager: AfEth;
  let votiumStrategy: VotiumStrategy;
  let safEthStrategy: SafEthStrategy;

  before(async () => {
    const afEthFactory = await ethers.getContractFactory("AfEth");
    afEthManager = (await upgrades.deployProxy(afEthFactory)) as AfEth;
    await afEthManager.deployed();

    const votiumStrategyFactory = await ethers.getContractFactory(
      "VotiumStrategy"
    );
    votiumStrategy = (await upgrades.deployProxy(votiumStrategyFactory, [
      afEthManager.address,
    ])) as VotiumStrategy;
    await votiumStrategy.deployed();

    const safEthStrategyFactory = await ethers.getContractFactory(
      "SafEthStrategy"
    );
    safEthStrategy = (await upgrades.deployProxy(safEthStrategyFactory, [
      afEthManager.address,
    ])) as SafEthStrategy;
    await safEthStrategy.deployed();

    await afEthManager.addStrategy(votiumStrategy.address);
    await afEthManager.addStrategy(safEthStrategy.address);
  });
  it("Should mint with uneven ratios", async function () {
    let votiumPositionCount = await votiumStrategy.vlCvxPositions(1);
    let safEthPositionCount = await safEthStrategy.safEthPositions(1);
    console.log({ votiumPositionCount });
    console.log({ safEthPositionCount });
    await afEthManager.mint(
      [ethers.utils.parseEther(".3"), ethers.utils.parseEther(".7")],
      { value: ethers.utils.parseEther("1") }
    );
    votiumPositionCount = await votiumStrategy.vlCvxPositions(1);
    safEthPositionCount = await safEthStrategy.safEthPositions(1);
    console.log({ votiumPositionCount });
    console.log({ safEthPositionCount });
  });
  it("Should mint with even ratios", async function () {
    await afEthManager.mint(
      [ethers.utils.parseEther(".5"), ethers.utils.parseEther(".5")],
      { value: ethers.utils.parseEther("1") }
    );
  });
  it("Should fail to mint with wrong ratios", async function () {
    await expect(
      afEthManager.mint(
        [ethers.utils.parseEther(".51"), ethers.utils.parseEther(".5")],
        { value: ethers.utils.parseEther("1") }
      )
    ).to.be.revertedWith("InvalidRatio");
  });
  it("Should request to close positions", async function () {
    // TODO
  });
  it("Can't request to close positions if not the owner", async function () {
    // TODO
  });
  it("Should burn positions", async function () {
    // TODO
  });
  it("Can't request burn positions if not the owner", async function () {
    // TODO
  });
  it("Should claim all rewards", async function () {
    // TODO
  });
});
