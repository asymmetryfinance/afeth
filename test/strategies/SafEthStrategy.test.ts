import { expect } from "chai";
import { SafEthStrategy } from "../../typechain-types";
import { ethers, upgrades, network } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("Test SafEth Strategy Specific Functionality", async function () {
  let safEthStrategy: SafEthStrategy;
  let accounts: any;
  beforeEach(async () => {
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.MAINNET_URL,
            blockNumber: parseInt(process.env.BLOCK_NUMBER as string, 10),
          },
        },
      ],
    });

    const safEthStrategyFactory = await ethers.getContractFactory(
      "SafEthStrategy"
    );
    safEthStrategy = (await upgrades.deployProxy(safEthStrategyFactory, [
      accounts[0].address,
    ])) as SafEthStrategy;
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

    const lockedValueBeforeBurn = await safEthStrategy.lockedValue(0);
    const balanceBefore = await ethers.provider.getBalance(accounts[0].address);
    const burnTx = await safEthStrategy.burn(0);
    await burnTx.wait();
    const lockedValueAfterBurn = await safEthStrategy.lockedValue(0);
    const balanceAfter = await ethers.provider.getBalance(accounts[0].address);
    const positionAfterBurn = await safEthStrategy.positions(0);

    expect(positionAfterClose.ethBurned).eq(0);
    expect(positionAfterBurn.ethBurned).gt(positionAfterClose.ethBurned);
    expect(balanceAfter).gt(balanceBefore);

    expect(lockedValueAfterBurn).eq(0);
    expect(lockedValueBeforeBurn).gt(lockedValueAfterBurn);
  });

  it("Should be able to call claimRewards() but have no effect because safEth strategy rewards are received upon burning", async function () {
    const mintTx = await safEthStrategy.mint({
      value: ethers.utils.parseEther("1"),
    });
    await mintTx.wait();

    await time.increase(60 * 60 * 24 * 30); // wait 30 days

    const claimableNow = await safEthStrategy.claimableNow(0);

    expect(claimableNow).eq(0);

    const balanceBefore = await ethers.provider.getBalance(accounts[0].address);
    const claimRewardsTx = await safEthStrategy.claimRewards(0);
    const minedRewardsTx = await claimRewardsTx.wait();
    const balanceAfter = await ethers.provider.getBalance(accounts[0].address);
    expect(balanceAfter).eq(
      balanceBefore.sub(
        minedRewardsTx.gasUsed.mul(minedRewardsTx.effectiveGasPrice)
      )
    );
  });

  it("Should fail to call burn() if it has already been called", async function () {
    const mintTx = await safEthStrategy.mint({
      value: ethers.utils.parseEther("1"),
    });
    await mintTx.wait();
    const requestCloseTx = await safEthStrategy.requestClose(0);
    await requestCloseTx.wait();
    const burnTx = await safEthStrategy.burn(0);
    await burnTx.wait();
    await expect(safEthStrategy.burn(0)).to.be.revertedWith(
      "ERC721: invalid token ID"
    );
  });

  it("Should fail to call requestClose() if no the owner", async function () {
    const mintTx = await safEthStrategy.mint({
      value: ethers.utils.parseEther("1"),
    });
    await mintTx.wait();

    const nonOwnerSigner = safEthStrategy.connect(accounts[1]);
    await expect(nonOwnerSigner.requestClose(0)).to.be.revertedWith(
      "VM Exception while processing transaction: reverted with reason string 'Not owner'"
    );
  });

  it("Should allow user to transfer minted nft to another user who is able to use it", async function () {
    // TODO
  });
});
