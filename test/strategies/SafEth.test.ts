import { expect } from "chai";
import { SafEthStrategy } from "../../typechain-types";
import { ethers, upgrades } from "hardhat";
describe.only("Test SafEth Strategy Specific Functionality", async function () {
  let safEthStrategy: SafEthStrategy;
  let accounts: any;
  before(async () => {
    const safEthStrategyFactory = await ethers.getContractFactory(
      "SafEthStrategy"
    );
    safEthStrategy = (await upgrades.deployProxy(
      safEthStrategyFactory
    )) as SafEthStrategy;
    await safEthStrategy.deployed();
    accounts = await ethers.getSigners();
  });

  it("Should mint() and be able to immediately requestClose() and burn() the position", async function () {
    const mintTx = await safEthStrategy.mint({
      value: ethers.utils.parseEther("1"),
    });
    await mintTx.wait();

    const positionBeforeClose = await safEthStrategy.positions(0);

    expect(positionBeforeClose.unlockTime).eq(0);

    await expect(safEthStrategy.burn(0)).to.be.revertedWith(
      "requestClose() not called"
    );

    const requestCloseTx = await safEthStrategy.requestClose(0);
    await requestCloseTx.wait();

    const positionAfterClose = await safEthStrategy.positions(0);
    const currentBlock = await ethers.provider.getBlockNumber();
    const currentBlockTimestamp = (await ethers.provider.getBlock(currentBlock))
      .timestamp;

    expect(positionAfterClose.unlockTime).eq(currentBlockTimestamp);

    const balanceBefore = await ethers.provider.getBalance(accounts[0].address);
    const burnTx = await safEthStrategy.burn(0);
    await burnTx.wait();
    const balanceAfter = await ethers.provider.getBalance(accounts[0].address);
    const positionAfterBurn = await safEthStrategy.positions(0);

    expect(positionAfterClose.ethBurned).eq(0);
    expect(positionAfterBurn.ethBurned).gt(positionAfterClose.ethBurned);
    expect(balanceAfter).gt(balanceBefore);
  });

  it("Should be able to call claimRewards() but have no effect because safEth rewards are received upon burning", async function () {
    // TODO
  });
});
