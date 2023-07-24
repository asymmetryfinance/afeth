import { SafEthStrategy } from "../../typechain-types";
import { ethers, upgrades } from "hardhat";
describe("Test SafEth Strategy Specific Functionality", async function () {
  let safEthStrategy: SafEthStrategy;
  before(async () => {
    const safEthStrategyFactory = await ethers.getContractFactory(
      "SafEthStrategy"
    );
    safEthStrategy = (await upgrades.deployProxy(
      safEthStrategyFactory
    )) as SafEthStrategy;
    await safEthStrategy.deployed();
  });

  it("Should mint() and be able to immediately requestClose() and burn() the position", async function () {
    // TODO
  });

  it("Should be able to call claimRewards() but have no effect because safEth rewards are received upon burning", async function () {
    // TODO
  });
});
