import { ethers, upgrades } from "hardhat";
import { AfEth } from "../typechain-types";

describe.only("Test AfEth (Votium + SafEth Strategies)", async function () {
  let afEthManager: AfEth;

  before(async () => {
    const afEthFactory = await ethers.getContractFactory("AfEth");
    afEthManager = (await upgrades.deployProxy(afEthFactory)) as AfEth;
    await afEthManager.deployed();
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
