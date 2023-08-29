import { expect } from "chai";
import { SafEthStrategy } from "../../../typechain-types";
import { ethers, upgrades, network } from "hardhat";
import { erc20Abi } from "../../abis/erc20Abi";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

describe("Test SafEth Strategy Specific Functionality", async function () {
  let safEthStrategy: SafEthStrategy;
  let accounts: SignerWithAddress[];
  const SAFETH_ADDRESS = "0x6732Efaf6f39926346BeF8b821a04B6361C4F3e5";

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
    accounts = await ethers.getSigners();

    // This is deploying before each test, will probably be slow
    const safEthStrategyFactory = await ethers.getContractFactory(
      "SafEthStrategy"
    );
    safEthStrategy = (await upgrades.deployProxy(safEthStrategyFactory, [
      accounts[0].address,
    ])) as SafEthStrategy;
    await safEthStrategy.deployed();
  });

  it("Should deposit() and be able to immediately withdraw() the position", async function () {
    const safEthContract = await ethers.getContractAt(
      erc20Abi,
      SAFETH_ADDRESS,
      accounts[0]
    );
    const safEthBalanceBefore = await safEthContract.balanceOf(
      safEthStrategy.address
    );
    const safEthStrategyBalanceBefore = await safEthStrategy.balanceOf(
      accounts[0].address
    );
    const mintTx = await safEthStrategy.deposit({
      value: ethers.utils.parseEther("1"),
    });
    await mintTx.wait();
    const safEthBalanceAfterDeposit = await safEthContract.balanceOf(
      safEthStrategy.address
    );
    const safEthStrategyBalanceAfterDeposit = await safEthStrategy.balanceOf(
      accounts[0].address
    );
    expect(safEthBalanceAfterDeposit).gt(safEthBalanceBefore);
    expect(safEthStrategyBalanceAfterDeposit).gt(safEthStrategyBalanceBefore);
    expect(safEthStrategyBalanceAfterDeposit).eq(safEthBalanceAfterDeposit);
    expect(safEthBalanceBefore).eq(0);
    expect(safEthStrategyBalanceBefore).eq(0);

    const balanceBefore = await ethers.provider.getBalance(accounts[0].address);
    const burnTx = await safEthStrategy.withdraw(0);
    await burnTx.wait();
    const balanceAfter = await ethers.provider.getBalance(accounts[0].address);

    const safEthBalanceAfterWithdraw = await safEthContract.balanceOf(
      safEthStrategy.address
    );
    const safEthStrategyBalanceAfterWithdraw = await safEthStrategy.balanceOf(
      accounts[0].address
    );
    expect(safEthBalanceAfterWithdraw).lt(safEthBalanceAfterDeposit);
    expect(safEthBalanceAfterWithdraw).eq(safEthStrategyBalanceAfterWithdraw);

    expect(balanceAfter).gt(balanceBefore);
  });
  it("Should be able to call requestWithdraw() but have no effect because safEth strategy rewards are received upon burning", async function () {
    const safEthBalanceBefore = await safEthStrategy.balanceOf(
      accounts[0].address
    );
    const mintTx = await safEthStrategy.deposit({
      value: ethers.utils.parseEther("1"),
    });
    await mintTx.wait();
    const safEthBalanceAfterDeposit = await safEthStrategy.balanceOf(
      accounts[0].address
    );

    expect(safEthBalanceAfterDeposit).gt(safEthBalanceBefore);
    expect(safEthBalanceBefore).eq(0);

    const requestTx = await safEthStrategy.requestWithdraw(
      safEthBalanceAfterDeposit
    );
    await requestTx.wait();

    const safEthBalanceAfterRequestWithdraw = await safEthStrategy.balanceOf(
      accounts[0].address
    );
    expect(safEthBalanceAfterRequestWithdraw).eq(safEthBalanceAfterDeposit);
  });
  it("Should fail to call withdraw() if balance is less than amount", async function () {
    await expect(safEthStrategy.withdraw(10)).to.be.reverted;
  });
  it("Should fail to call requestClose() if no balance", async function () {
    await expect(safEthStrategy.requestWithdraw(10)).to.be.revertedWith(
      "Insufficient balance"
    );
  });
});
