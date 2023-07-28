import { ethers, upgrades } from "hardhat";
import { AfEth } from "../typechain-types";
import { VotiumStrategy } from "../typechain-types";
import { SafEthStrategy } from "../typechain-types";

describe("Test AfEth (Votium + SafEth Strategies)", async function () {
  let afEthManager: AfEth;

  before(async () => {
    console.log(1);

    const accounts = await ethers.getSigners();
    console.log(1);
    const votiumStrategyFactory = await ethers.getContractFactory(
      "VotiumStrategy"
    );
    const votiumStrategy = (await upgrades.deployProxy(votiumStrategyFactory, [
      accounts[0].address,
    ])) as VotiumStrategy;
    await votiumStrategy.deployed();
    console.log(1);

    const safEthStrategyFactory = await ethers.getContractFactory(
      "SafEthStrategy"
    );
    const safEthStrategy = (await upgrades.deployProxy(safEthStrategyFactory, [
      accounts[0].address,
    ])) as SafEthStrategy;
    await safEthStrategy.deployed();
    console.log(1);

    const afEthFactory = await ethers.getContractFactory("AfEth");
    afEthManager = (await upgrades.deployProxy(afEthFactory, [
      votiumStrategy,
      safEthStrategy,
    ])) as AfEth;
    await afEthManager.deployed();
    console.log(1);
  });

  it("Should mint with uneven ratios", async function () {
    await afEthManager.mint(ethers.utils.parseEther("1"), [30, 70]);
  });
  it("Should mint with even ratios", async function () {
    // TODO
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
