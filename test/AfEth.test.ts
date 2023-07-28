import { ethers, upgrades } from "hardhat";
import { AfEth } from "../typechain-types";
import { expect } from "chai";
// import { VotiumStrategy } from "../typechain-types";
// import { SafEthStrategy } from "../typechain-types";

describe.only("Test AfEth (Votium + SafEth Strategies)", async function () {
  let afEthManager: AfEth;

  before(async () => {
    const afEthFactory = await ethers.getContractFactory("AfEth");
    afEthManager = (await upgrades.deployProxy(afEthFactory)) as AfEth;
    await afEthManager.deployed();

    const votiumStrategyFactory = await ethers.getContractFactory(
      "VotiumStrategy"
    );
    const votiumStrategy = await upgrades.deployProxy(votiumStrategyFactory, [
      "0x2498e8059929e18e2a2cED4e32ef145fa2F4a744",
    ]);
    await votiumStrategy.deployed();

    const safEthStrategyFactory = await ethers.getContractFactory(
      "SafEthStrategy"
    );
    const safEthStrategy = await upgrades.deployProxy(safEthStrategyFactory, [
      "0x2498e8059929e18e2a2cED4e32ef145fa2F4a744",
    ]);
    await safEthStrategy.deployed();

    await afEthManager.addStrategy(votiumStrategy.address);
    await afEthManager.addStrategy(safEthStrategy.address);
  });
  it("Should mint with uneven ratios", async function () {
    await afEthManager.mint(ethers.utils.parseEther("1"), [30, 70]);
  });
  it("Should mint with even ratios", async function () {
    await afEthManager.mint(ethers.utils.parseEther("1"), [50, 50]);
  });
  it("Should fail to mint with wrong ratios", async function () {
    await expect(
      afEthManager.mint(ethers.utils.parseEther("1"), [51, 50])
    ).to.be.revertedWith("InvalidRatio");
  });
  it("Should request to close positions", async function () {
    // TODO
  });
  it("Should burn positions", async function () {
    // TODO
  });
  it("Should claim all rewards", async function () {
    // TODO
  });
});
