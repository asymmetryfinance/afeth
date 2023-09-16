import { network, ethers, upgrades } from "hardhat";
import {
  VotiumErc20Strategy,
  VotiumErc20StrategyCore,
} from "../../../typechain-types";
import { expect } from "chai";
import {
  incrementVlcvxEpoch,
  oracleApplyRewards,
  requestWithdrawal,
} from "./VotiumTestHelpers";
import { BigNumber } from "ethers";
import { within1Percent } from "../../helpers/helpers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { erc20Abi } from "../../abis/erc20Abi";

describe("Test VotiumErc20Strategy", async function () {
  let votiumStrategy: VotiumErc20Strategy & VotiumErc20StrategyCore;
  let accounts: SignerWithAddress[];
  let rewarderAccount: SignerWithAddress;

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
      "VotiumErc20Strategy"
    );
    rewarderAccount = accounts[9];
    votiumStrategy = (await upgrades.deployProxy(votiumStrategyFactory, [
      accounts[0].address,
      rewarderAccount.address,
      "0x0000000000000000000000000000000000000000", // TODO this should be an afEth mock but doesnt matter right now
      "0x0000000000000000000000000000000000000000",
    ])) as VotiumErc20Strategy;
    await votiumStrategy.deployed();
    // mint some to seed the system so totalSupply is never 0 (prevent price weirdness on withdraw)
    const tx = await votiumStrategy.connect(accounts[11]).deposit({
      value: ethers.utils.parseEther(".0001"),
    });
    await tx.wait();
  };

  beforeEach(
    async () => await resetToBlock(parseInt(process.env.BLOCK_NUMBER ?? "0"))
  );

  it("Should mint afEth tokens, burn tokens some tokens, pass time & process withdraw queue", async function () {
    const startingTotalSupply = await votiumStrategy.totalSupply();
    let tx = await votiumStrategy.deposit({
      value: ethers.utils.parseEther("1"),
    });
    await tx.wait();

    const afEthBalance1 = await votiumStrategy.balanceOf(accounts[0].address);
    const totalSupply1 = await votiumStrategy.totalSupply();

    expect(totalSupply1).eq(
      BigNumber.from(afEthBalance1).add(startingTotalSupply)
    );

    // request to withdraw
    const withdrawId = await requestWithdrawal(
      votiumStrategy,
      await votiumStrategy.balanceOf(accounts[0].address)
    );

    // pass enough epochs so the burned position is fully unlocked
    for (let i = 0; i < 17; i++) {
      await incrementVlcvxEpoch();
    }

    const ethBalanceBefore = await ethers.provider.getBalance(
      accounts[0].address
    );

    // withdraw
    tx = await votiumStrategy.withdraw(withdrawId);
    await tx.wait();

    const ethBalanceAfter = await ethers.provider.getBalance(
      accounts[0].address
    );
    // balance after fully withdrawing is higher
    expect(ethBalanceAfter).gt(ethBalanceBefore);
  });
  it("Should mint afEth tokens, burn tokens some tokens, pass time & process withdraw queue for multiple accounts", async function () {
    const startingTotalSupply = await votiumStrategy.totalSupply();
    const stakerAmounts = 2;

    let tx;
    let runningBalance = BigNumber.from(startingTotalSupply);
    for (let i = 1; i <= stakerAmounts; i++) {
      const stakerVotiumStrategy = votiumStrategy.connect(accounts[i]);
      tx = await stakerVotiumStrategy.deposit({
        value: ethers.utils.parseEther("1"),
      });
      await tx.wait();
      const afEthBalance = await votiumStrategy.balanceOf(accounts[i].address);
      runningBalance = runningBalance.add(afEthBalance);
    }

    const totalSupply1 = await votiumStrategy.totalSupply();
    expect(totalSupply1).eq(runningBalance);

    expect(
      within1Percent(
        await votiumStrategy.balanceOf(accounts[1].address),
        await votiumStrategy.balanceOf(accounts[2].address)
      )
    ).eq(true);

    const withdrawIds = [];
    // request withdraw for each account
    for (let i = 1; i <= stakerAmounts; i++) {
      const stakerVotiumStrategy = votiumStrategy.connect(accounts[i]);
      const withdrawId = await requestWithdrawal(
        stakerVotiumStrategy,
        await stakerVotiumStrategy.balanceOf(accounts[i].address)
      );

      withdrawIds.push(withdrawId);
    }

    // go to next epoch
    for (let i = 0; i < 17; i++) {
      await incrementVlcvxEpoch();
    }

    // withdraw from queue
    const balancesBefore = [];
    const balancesAfter = [];
    let withdrawIndex = 0;
    for (let i = 1; i <= stakerAmounts; i++) {
      const withdrawId = withdrawIds[withdrawIndex];
      const stakerVotiumStrategy = votiumStrategy.connect(accounts[i]);
      // pass enough epochs so the burned position is fully unlocked
      const ethBalanceBefore = await ethers.provider.getBalance(
        accounts[i].address
      );
      balancesBefore.push(ethBalanceBefore);
      tx = await stakerVotiumStrategy.withdraw(withdrawId);
      await tx.wait();

      const ethBalanceAfter = await ethers.provider.getBalance(
        accounts[i].address
      );
      balancesAfter.push(ethBalanceAfter);
      // balance after fully withdrawing is higher
      expect(ethBalanceAfter).gt(ethBalanceBefore);
      withdrawIndex++;
    }
    // verify balances are within 1% of each other
    for (let i = 0; i < stakerAmounts; i++) {
      expect(within1Percent(balancesBefore[i], balancesAfter[i])).eq(true);
    }
  });
  it("Should allow 1 user to withdraw over two epochs", async function () {
    let tx = await votiumStrategy.deposit({
      value: ethers.utils.parseEther("1"),
    });
    await tx.wait();

    // burn half of balance
    let withdrawId = await requestWithdrawal(
      votiumStrategy,
      (await votiumStrategy.balanceOf(accounts[0].address)).div(2)
    );

    // pass enough epochs so the burned position is fully unlocked
    for (let i = 0; i < 17; i++) {
      await incrementVlcvxEpoch();
    }

    tx = await votiumStrategy.withdraw(withdrawId);
    await tx.wait();

    // burn remaining balance
    withdrawId = await requestWithdrawal(
      votiumStrategy,
      await votiumStrategy.balanceOf(accounts[0].address)
    );

    // pass enough epochs so the burned position is fully unlocked
    for (let i = 0; i < 17; i++) {
      await incrementVlcvxEpoch();
    }

    tx = await votiumStrategy.withdraw(withdrawId);
    await tx.wait();
    expect(await votiumStrategy.balanceOf(accounts[0].address)).eq(0);
  });
  it("Should allow multiple users to withdraw over two epochs", async function () {
    const stakerVotiumStrategy1 = votiumStrategy.connect(accounts[1]);
    const stakerVotiumStrategy2 = votiumStrategy.connect(accounts[2]);

    // mint for both accounts
    let tx = await stakerVotiumStrategy1.deposit({
      value: ethers.utils.parseEther("1"),
    });
    await tx.wait();
    tx = await stakerVotiumStrategy2.deposit({
      value: ethers.utils.parseEther("1"),
    });
    await tx.wait();

    await oracleApplyRewards(rewarderAccount, votiumStrategy.address);

    // burn half of balance for each address
    const withdrawId1 = await requestWithdrawal(
      stakerVotiumStrategy1,
      (await stakerVotiumStrategy1.balanceOf(accounts[1].address)).div(2)
    );
    const withdrawId2 = await requestWithdrawal(
      stakerVotiumStrategy2,
      (await votiumStrategy.balanceOf(accounts[2].address)).div(2)
    );

    // pass enough epochs so the burned position is fully unlocked
    for (let i = 0; i < 17; i++) {
      await incrementVlcvxEpoch();
    }

    let ethBalanceBefore1 = await ethers.provider.getBalance(
      accounts[1].address
    );
    let ethBalanceBefore2 = await ethers.provider.getBalance(
      accounts[2].address
    );
    tx = await stakerVotiumStrategy1.withdraw(withdrawId1);
    await tx.wait();
    tx = await stakerVotiumStrategy2.withdraw(withdrawId2);
    await tx.wait();
    let ethBalanceAfter1 = await ethers.provider.getBalance(
      accounts[1].address
    );
    let ethBalanceAfter2 = await ethers.provider.getBalance(
      accounts[2].address
    );
    // balance after fully withdrawing is higher
    expect(ethBalanceAfter1).gt(ethBalanceBefore1);
    expect(ethBalanceAfter2).gt(ethBalanceBefore2);

    // burn remaining balance
    const withdrawId3 = await requestWithdrawal(
      stakerVotiumStrategy1,
      await stakerVotiumStrategy1.balanceOf(accounts[1].address)
    );
    const withdrawId4 = await requestWithdrawal(
      stakerVotiumStrategy2,
      await stakerVotiumStrategy2.balanceOf(accounts[2].address)
    );

    // pass enough epochs so the burned position is fully unlocked
    for (let i = 0; i < 17; i++) {
      await incrementVlcvxEpoch();
    }

    ethBalanceBefore1 = await ethers.provider.getBalance(accounts[1].address);
    ethBalanceBefore2 = await ethers.provider.getBalance(accounts[2].address);
    tx = await stakerVotiumStrategy1.withdraw(withdrawId3);
    await tx.wait();
    tx = await stakerVotiumStrategy2.withdraw(withdrawId4);
    await tx.wait();
    ethBalanceAfter1 = await ethers.provider.getBalance(accounts[1].address);
    ethBalanceAfter2 = await ethers.provider.getBalance(accounts[2].address); // balance after fully withdrawing is higher
    expect(ethBalanceAfter1).gt(ethBalanceBefore1);
    expect(ethBalanceAfter2).gt(ethBalanceBefore2);
    expect(await votiumStrategy.balanceOf(accounts[0].address)).eq(0);
  });
  it("Should never take more than 16 weeks to withdraw from the queue", async function () {
    let tx = await votiumStrategy.deposit({
      value: ethers.utils.parseEther("1"),
    });
    await tx.wait();

    // burn half of balance
    const withdrawId = await requestWithdrawal(
      votiumStrategy,
      await votiumStrategy.balanceOf(accounts[0].address)
    );

    // pass enough epochs so the burned position is almost fully unlocked
    for (let i = 0; i < 16; i++) {
      await incrementVlcvxEpoch();
    }

    await expect(votiumStrategy.withdraw(withdrawId)).to.be.revertedWith(
      "Can't withdraw from future epoch"
    );
    await incrementVlcvxEpoch();

    tx = await votiumStrategy.withdraw(withdrawId);
    await tx.wait();

    expect(await votiumStrategy.balanceOf(accounts[0].address)).eq(0);
  });
  it("Should allow owner to withdraw stuck tokens with withdrawStuckTokens()", async function () {
    const stuckToken = "0xb620be8a1949aa9532e6a3510132864ef9bc3f82";
    const StuckTokenContract = await ethers.getContractAt(
      erc20Abi,
      stuckToken,
      accounts[0]
    );

    await oracleApplyRewards(rewarderAccount, votiumStrategy.address);
    let stuckTokenBalance = await StuckTokenContract.balanceOf(
      accounts[0].address
    );
    votiumStrategy.withdrawStuckTokens(stuckToken);
    expect(stuckTokenBalance).eq(0);
    stuckTokenBalance = await StuckTokenContract.balanceOf(accounts[0].address);
    expect(stuckTokenBalance).gt(0);
  });
});
