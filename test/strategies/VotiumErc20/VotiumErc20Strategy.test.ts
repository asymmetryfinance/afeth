import { network, ethers, upgrades } from "hardhat";
import { VotiumErc20Strategy } from "../../../typechain-types";
import { expect } from "chai";
import {
  incrementVlcvxEpoch,
  oracleApplyRewards,
  requestWithdrawal,
} from "./VotiumTestHelpers";
import { BigNumber } from "ethers";
import { within1Percent, within2Percent } from "../../helpers/helpers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { erc20Abi } from "../../abis/erc20Abi";

describe("Test VotiumErc20Strategy", async function () {
  let votiumStrategy: VotiumErc20Strategy;
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
    ])) as VotiumErc20Strategy;
    await votiumStrategy.deployed();
    // mint some to seed the system so totalSupply is never 0 (prevent price weirdness on withdraw)
    const tx = await votiumStrategy.connect(accounts[11]).mint({
      value: ethers.utils.parseEther(".0001"),
    });
    await tx.wait();
  };

  beforeEach(
    async () => await resetToBlock(parseInt(process.env.BLOCK_NUMBER ?? "0"))
  );

  it("Should mint afEth tokens, burn tokens some tokens, apply rewards, pass time & process withdraw queue", async function () {
    const startingTotalSupply = await votiumStrategy.totalSupply();
    let tx = await votiumStrategy.mint({
      value: ethers.utils.parseEther("1"),
    });
    await tx.wait();

    const afEthBalance1 = await votiumStrategy.balanceOf(accounts[0].address);
    const totalSupply1 = await votiumStrategy.totalSupply();

    expect(totalSupply1).eq(
      BigNumber.from(afEthBalance1).add(startingTotalSupply)
    );

    const priceBeforeRewards = await votiumStrategy.price();

    await oracleApplyRewards(rewarderAccount, votiumStrategy.address);

    const priceAfterRewards = await votiumStrategy.price();

    expect(priceAfterRewards).gt(priceBeforeRewards);

    // request to withdraw
    const unlockEpoch = await requestWithdrawal(
      votiumStrategy,
      await votiumStrategy.balanceOf(accounts[0].address)
    );
    console.log('unlockEpoch', unlockEpoch)

    // pass enough epochs so the burned position is fully unlocked
    for (let i = 0; i < 17; i++) {
      await incrementVlcvxEpoch();
    }

    const ethBalanceBefore = await ethers.provider.getBalance(
      accounts[0].address
    );

    // withdraw
    tx = await votiumStrategy.withdraw(unlockEpoch);
    await tx.wait();

    const ethBalanceAfter = await ethers.provider.getBalance(
      accounts[0].address
    );
    // balance after fully withdrawing is higher
    expect(ethBalanceAfter).gt(ethBalanceBefore);
  });
  it("Should mint afEth tokens, burn tokens some tokens, apply rewards, pass time & process withdraw queue for multiple accounts", async function () {

    console.log('wtf0')
    const startingTotalSupply = await votiumStrategy.totalSupply();
    const stakerAmounts = 2;
    console.log('wtf1')

    let tx;
    let runningBalance = BigNumber.from(startingTotalSupply);
    for (let i = 1; i <= stakerAmounts; i++) {
      console.log('looping', i)
      const stakerVotiumStrategy = votiumStrategy.connect(accounts[i]);
      tx = await stakerVotiumStrategy.mint({
        value: ethers.utils.parseEther("1"),
      });
      await tx.wait();
      const afEthBalance = await votiumStrategy.balanceOf(accounts[i].address);
      runningBalance = runningBalance.add(afEthBalance);
      console.log('running balance', runningBalance.toString())
    }
    console.log('wtf2')

    const totalSupply1 = await votiumStrategy.totalSupply();
    expect(totalSupply1).eq(runningBalance);
    const priceBeforeRewards = await votiumStrategy.price();
    console.log('wtf3')

    // claim rewards
    await oracleApplyRewards(rewarderAccount, votiumStrategy.address);
    console.log('wtf4')
    const priceAfterRewards = await votiumStrategy.price();
    console.log('wtf5')

    expect(priceAfterRewards).gt(priceBeforeRewards);
    console.log('wtf6')
    expect(
      within1Percent(
        await votiumStrategy.balanceOf(accounts[1].address),
        await votiumStrategy.balanceOf(accounts[2].address)
      )
    ).eq(true);
    console.log('wtf7')

    // request withdraw for each account
    let unlockEpoch;
    for (let i = 1; i <= stakerAmounts; i++) {
      console.log('looping on',i);
      const stakerVotiumStrategy = votiumStrategy.connect(accounts[i]);
      console.log('loop 2')
      unlockEpoch = await requestWithdrawal(
        stakerVotiumStrategy,
        await stakerVotiumStrategy.balanceOf(accounts[i].address)
      );
      console.log('loop 3', unlockEpoch);

      const unlock = await votiumStrategy.unlockQueues(
        accounts[i].address,
        unlockEpoch
      );
      console.log('loop 4')
      expect(unlock.cvxOwed).gt(0);
    }
    console.log('wtf8')

    // go to next epoch
    for (let i = 0; i < 17; i++) {
      await incrementVlcvxEpoch();
    }
    console.log('wtf9')

    // withdraw from queue
    const balancesBefore = [];
    const balancesAfter = [];
    for (let i = 1; i <= stakerAmounts; i++) {
      const stakerVotiumStrategy = votiumStrategy.connect(accounts[i]);
      // pass enough epochs so the burned position is fully unlocked
      const ethBalanceBefore = await ethers.provider.getBalance(
        accounts[i].address
      );
      balancesBefore.push(ethBalanceBefore);
      tx = await stakerVotiumStrategy.withdraw(unlockEpoch as string);
      await tx.wait();

      const ethBalanceAfter = await ethers.provider.getBalance(
        accounts[i].address
      );
      balancesAfter.push(ethBalanceAfter);
      // balance after fully withdrawing is higher
      expect(ethBalanceAfter).gt(ethBalanceBefore);
    }
    console.log('wtf5')
    // verify balances are within 1% of each other
    for (let i = 0; i < stakerAmounts; i++) {
      expect(within1Percent(balancesBefore[i], balancesAfter[i])).eq(true);
    }
  });
  it("Should show 2 accounts receive different rewards during different epochs", async function () {
    const stakeAmount = ethers.utils.parseEther("10");
    const stakerVotiumStrategy1 = votiumStrategy.connect(accounts[1]);
    const stakerVotiumStrategy2 = votiumStrategy.connect(accounts[2]);

    // first account mints before rewards are claimed
    let tx = await stakerVotiumStrategy1.mint({
      value: stakeAmount,
    });
    await tx.wait();

    const priceBeforeRewards = await votiumStrategy.price();

    // Claim rewards
    await oracleApplyRewards(rewarderAccount, votiumStrategy.address);

    const priceAfterRewardsBeforeSecondStake = await votiumStrategy.price();

    // second account mints after rewards are claimed
    tx = await stakerVotiumStrategy2.mint({
      value: stakeAmount,
    });
    await tx.wait();

    const priceAfterRewardsAfterSecondStake = await votiumStrategy.price();

    expect(priceAfterRewardsBeforeSecondStake).eq(
      priceAfterRewardsAfterSecondStake
    );
    expect(priceAfterRewardsAfterSecondStake).gt(priceBeforeRewards);

    // Claim rewards again
    await oracleApplyRewards(rewarderAccount, votiumStrategy.address);

    const priceAfterAllRewards = await votiumStrategy.price();
    expect(priceAfterAllRewards).gt(priceAfterRewardsAfterSecondStake);

    // request withdraw for each account
    await stakerVotiumStrategy1.requestWithdraw(
      await stakerVotiumStrategy1.balanceOf(accounts[1].address)
    );
    const unlockEpoch = await requestWithdrawal(
      stakerVotiumStrategy2,
      await stakerVotiumStrategy2.balanceOf(accounts[2].address)
    );

    // go to next epoch
    for (let i = 0; i < 17; i++) {
      await incrementVlcvxEpoch();
    }

    // withdraw from queue
    // pass enough epochs so the burned position is fully unlocked
    const ethBalanceBefore1 = await ethers.provider.getBalance(
      accounts[1].address
    );

    tx = await stakerVotiumStrategy1.withdraw(unlockEpoch);
    await tx.wait();
    const ethBalanceAfter1 = await ethers.provider.getBalance(
      accounts[1].address
    );
    // balance after fully withdrawing is higher
    expect(ethBalanceAfter1).gt(ethBalanceBefore1);
    const rewardAmount1 = ethBalanceAfter1
      .sub(ethBalanceBefore1)
      .sub(stakeAmount);

    const ethBalanceBefore2 = await ethers.provider.getBalance(
      accounts[2].address
    );

    tx = await stakerVotiumStrategy2.withdraw(unlockEpoch);
    await tx.wait();

    const ethBalanceAfter2 = await ethers.provider.getBalance(
      accounts[2].address
    );
    // balance after fully withdrawing is higher
    expect(ethBalanceAfter2).gt(ethBalanceBefore2);
    const rewardAmount2 = ethBalanceAfter2
      .sub(ethBalanceBefore2)
      .sub(stakeAmount);
    expect(rewardAmount1).gt(rewardAmount2.mul(2));
  });
  it("Should show 2 accounts receive same rewards during different epochs if account2 staked enough to match account1", async function () {
    const stakeAmount = ethers.utils.parseEther("10");
    const stakerVotiumStrategy1 = votiumStrategy.connect(accounts[1]);
    const stakerVotiumStrategy2 = votiumStrategy.connect(accounts[2]);

    // first account mints before rewards are claimed
    let tx = await stakerVotiumStrategy1.mint({
      value: stakeAmount,
    });
    await tx.wait();
    const priceBeforeRewards = await votiumStrategy.price();

    // Claim rewards
    await oracleApplyRewards(rewarderAccount, votiumStrategy.address);

    const priceAfterRewardsBeforeSecondStake = await votiumStrategy.price();
    // the second stake amount is calculated by how many rewards went into the system
    const stakeAmount2 = priceAfterRewardsBeforeSecondStake
      .mul(stakeAmount)
      .div(ethers.utils.parseEther("1"));

    // second account mints after rewards are claimed
    tx = await stakerVotiumStrategy2.mint({
      value: stakeAmount2,
    });
    await tx.wait();

    const priceAfterRewardsAfterSecondStake = await votiumStrategy.price();

    expect(priceAfterRewardsBeforeSecondStake).eq(
      priceAfterRewardsAfterSecondStake
    );
    expect(priceAfterRewardsAfterSecondStake).gt(priceBeforeRewards);

    // Claim rewards again
    await oracleApplyRewards(rewarderAccount, votiumStrategy.address);

    const priceAfterAllRewards = await votiumStrategy.price();
    expect(priceAfterAllRewards).gt(priceAfterRewardsAfterSecondStake);
    const balance1 = await stakerVotiumStrategy1.balanceOf(accounts[1].address);
    const balance2 = await stakerVotiumStrategy2.balanceOf(accounts[2].address);

    expect(within2Percent(balance1, balance2)).eq(true);
    // request withdraw for each account
    await stakerVotiumStrategy1.requestWithdraw(balance1);
    const unlockEpoch = await requestWithdrawal(
      stakerVotiumStrategy2,
      balance2
    );

    // go to next epoch
    for (let i = 0; i < 17; i++) {
      await incrementVlcvxEpoch();
    }

    // withdraw from queue
    // pass enough epochs so the burned position is fully unlocked
    const ethBalanceBefore1 = await ethers.provider.getBalance(
      accounts[1].address
    );

    tx = await stakerVotiumStrategy1.withdraw(unlockEpoch);
    await tx.wait();
    const ethBalanceAfter1 = await ethers.provider.getBalance(
      accounts[1].address
    );
    // balance after fully withdrawing is higher
    expect(ethBalanceAfter1).gt(ethBalanceBefore1);
    const rewardAmount1 = ethBalanceAfter1
      .sub(ethBalanceBefore1)
      .sub(stakeAmount);

    const ethBalanceBefore2 = await ethers.provider.getBalance(
      accounts[2].address
    );

    tx = await stakerVotiumStrategy2.withdraw(unlockEpoch);
    await tx.wait();

    const ethBalanceAfter2 = await ethers.provider.getBalance(
      accounts[2].address
    );
    // balance after fully withdrawing is higher
    expect(ethBalanceAfter2).gt(ethBalanceBefore2);
    const rewardAmount2 = ethBalanceAfter2
      .sub(ethBalanceBefore2)
      .sub(stakeAmount);

      console.log('rewardAmount1', rewardAmount1.toString())
      console.log('rewardAmount2', rewardAmount2.toString())
    // expect(within2Percent(rewardAmount1, rewardAmount2)).eq(true);
  });
  it("Should show 2 accounts receive the same rewards if hodling the same amount for the same time", async function () {
    const startingTotalSupply = await votiumStrategy.totalSupply();
    const stakerAmounts = 2;
    const stakeAmount = ethers.utils.parseEther("4");

    let tx;
    let runningBalance = BigNumber.from(startingTotalSupply);
    for (let i = 1; i <= stakerAmounts; i++) {
      const stakerVotiumStrategy = votiumStrategy.connect(accounts[i]);
      tx = await stakerVotiumStrategy.mint({
        value: stakeAmount,
      });
      await tx.wait();

      const afEthBalance = await votiumStrategy.balanceOf(accounts[i].address);
      runningBalance = runningBalance.add(afEthBalance);
    }

    const totalSupply1 = await votiumStrategy.totalSupply();
    expect(totalSupply1).eq(runningBalance);
    const priceBeforeRewards = await votiumStrategy.price();

    await oracleApplyRewards(rewarderAccount, votiumStrategy.address);

    const priceAfterRewards = await votiumStrategy.price();

    expect(priceAfterRewards).gt(priceBeforeRewards);

    // request withdraw for each account
    let unlockEpoch;
    for (let i = 1; i <= stakerAmounts; i++) {
      const stakerVotiumStrategy = votiumStrategy.connect(accounts[i]);
      unlockEpoch = await requestWithdrawal(
        stakerVotiumStrategy,
        await stakerVotiumStrategy.balanceOf(accounts[i].address)
      );

      const unlock = await votiumStrategy.unlockQueues(
        accounts[i].address,
        unlockEpoch
      );
      expect(unlock.cvxOwed).gt(0);
    }

    // go to next epoch
    for (let i = 0; i < 17; i++) {
      await incrementVlcvxEpoch();
    }

    // withdraw from queue
    const rewardsGained = [];
    for (let i = 1; i <= stakerAmounts; i++) {
      const stakerVotiumStrategy = votiumStrategy.connect(accounts[i]);
      // pass enough epochs so the burned position is fully unlocked
      const ethBalanceBefore = await ethers.provider.getBalance(
        accounts[i].address
      );
      tx = await stakerVotiumStrategy.withdraw(unlockEpoch as string);
      await tx.wait();

      const ethBalanceAfter = await ethers.provider.getBalance(
        accounts[i].address
      );

      // balance after fully withdrawing is higher
      expect(ethBalanceAfter).gt(ethBalanceBefore);

      // amount of rewards sent to account
      rewardsGained.push(
        ethBalanceAfter.sub(ethBalanceBefore).sub(stakeAmount)
      );
    }

    // rewards should be proportional to amount staked
    // if stakerAmounts = 2 then the rewards of the previous staker should be double the rewards of the next staker
    for (let i = 0; i < rewardsGained.length; i++) {
      if (i === 0) continue;
      expect(within1Percent(rewardsGained[i - 1], rewardsGained[i])).eq(true);
    }
  });
  it("Should show an account with twice as many tokens receive twice as many rewards as another", async function () {
    const startingTotalSupply = await votiumStrategy.totalSupply();
    const stakerAmounts = 2;
    const stakeAmount = ethers.utils.parseEther("2");

    let tx;
    let runningBalance = BigNumber.from(startingTotalSupply);

    // mint for two accounts
    for (let i = 1; i <= stakerAmounts; i++) {
      const stakerVotiumStrategy = votiumStrategy.connect(accounts[i]);
      tx = await stakerVotiumStrategy.mint({
        value: stakeAmount.div(i),
      });
      await tx.wait();
      const afEthBalance = await votiumStrategy.balanceOf(accounts[i].address);
      runningBalance = runningBalance.add(afEthBalance);
    }

    const totalSupply1 = await votiumStrategy.totalSupply();
    expect(totalSupply1).eq(runningBalance);

    // claim rewards
    const priceBeforeRewards = await votiumStrategy.price();

    await oracleApplyRewards(rewarderAccount, votiumStrategy.address);

    const priceAfterRewards = await votiumStrategy.price();
    expect(priceAfterRewards).gt(priceBeforeRewards);

    // request withdraw for each account
    let unlockEpoch;
    for (let i = 1; i <= stakerAmounts; i++) {
      const stakerVotiumStrategy = votiumStrategy.connect(accounts[i]);
      unlockEpoch = await requestWithdrawal(
        stakerVotiumStrategy,
        await stakerVotiumStrategy.balanceOf(accounts[i].address)
      );

      const unlock = await votiumStrategy.unlockQueues(
        accounts[i].address,
        unlockEpoch
      );
      expect(unlock.cvxOwed).gt(0);
    }

    // go to next epoch
    for (let i = 0; i < 17; i++) {
      await incrementVlcvxEpoch();
    }

    // withdraw from queue
    const rewardsGained = [];
    for (let i = 1; i <= stakerAmounts; i++) {
      const stakerVotiumStrategy = votiumStrategy.connect(accounts[i]);
      // pass enough epochs so the burned position is fully unlocked
      const ethBalanceBefore = await ethers.provider.getBalance(
        accounts[i].address
      );
      tx = await stakerVotiumStrategy.withdraw(unlockEpoch as string);
      await tx.wait();

      const ethBalanceAfter = await ethers.provider.getBalance(
        accounts[i].address
      );

      // balance after fully withdrawing is higher
      expect(ethBalanceAfter).gt(ethBalanceBefore);

      // amount of rewards sent to account
      rewardsGained.push(
        ethBalanceAfter.sub(ethBalanceBefore).sub(stakeAmount.div(i))
      );
    }

    // rewards should be proportional to amount staked
    // if stakerAmounts = 2 then the rewards of the previous staker should be double the rewards of the next staker
    for (let i = 0; i < rewardsGained.length; i++) {
      if (i === 0) continue;
      expect(
        within1Percent(
          rewardsGained[i - 1],
          rewardsGained[i].mul(stakerAmounts)
        )
      ).eq(true);
    }
  });
  it("Should increase price proportionally to how much rewards were added vs tvl", async function () {
    const stakeAmount = ethers.utils.parseEther("25");
    const tx = await votiumStrategy.mint({
      value: stakeAmount,
    });
    await tx.wait();

    const priceBeforeRewards = await votiumStrategy.price();
    const depositedRewards = await oracleApplyRewards(
      rewarderAccount,
      votiumStrategy.address
    );
    const priceAfterRewards = await votiumStrategy.price();

    const rewardPriceDifference = priceAfterRewards.sub(priceBeforeRewards);
    const rewardAmount = rewardPriceDifference
      .mul(stakeAmount)
      .div(ethers.utils.parseEther("1"));

    // Price should be near what the price is reflecting (not exact due to slippage)
    expect(within1Percent(rewardAmount, depositedRewards?.args?.ethAmount)).eq(
      true
    );
  });
  it("Should increase price twice as much when depositing twice as much rewards", async function () {
    const stakeAmount = ethers.utils.parseEther("25");
    const tx = await votiumStrategy.mint({
      value: stakeAmount,
    });
    await tx.wait();

    const priceBeforeRewards = await votiumStrategy.price();
    const depositedRewards1 = await oracleApplyRewards(
      rewarderAccount,
      votiumStrategy.address
    );
    const depositedRewards2 = await oracleApplyRewards(
      rewarderAccount,
      votiumStrategy.address
    );
    const priceAfterRewards = await votiumStrategy.price();

    const rewardPriceDifference = priceAfterRewards.sub(priceBeforeRewards);
    const rewardAmount = rewardPriceDifference
      .mul(stakeAmount)
      .div(ethers.utils.parseEther("1"));
    const eventRewardAmount = BigNumber.from(
      depositedRewards1?.args?.ethAmount
    ).add(depositedRewards2?.args?.ethAmount);

    // Price should be near what the price is reflecting (not exact due to slippage)
    expect(within1Percent(rewardAmount, eventRewardAmount)).eq(true);
  });
  it("Should allow 1 user to withdraw over two epochs", async function () {
    let tx = await votiumStrategy.mint({
      value: ethers.utils.parseEther("1"),
    });
    await tx.wait();

    const priceBeforeRewards = await votiumStrategy.price();
    await oracleApplyRewards(rewarderAccount, votiumStrategy.address);

    const priceAfterRewards = await votiumStrategy.price();
    expect(priceAfterRewards).gt(priceBeforeRewards);

    // burn half of balance
    let unlockEpoch = await requestWithdrawal(
      votiumStrategy,
      (await votiumStrategy.balanceOf(accounts[0].address)).div(2)
    );

    // pass enough epochs so the burned position is fully unlocked
    for (let i = 0; i < 17; i++) {
      await incrementVlcvxEpoch();
    }

    tx = await votiumStrategy.withdraw(unlockEpoch);
    await tx.wait();

    // burn remaining balance
    unlockEpoch = await requestWithdrawal(
      votiumStrategy,
      await votiumStrategy.balanceOf(accounts[0].address)
    );

    // pass enough epochs so the burned position is fully unlocked
    for (let i = 0; i < 17; i++) {
      await incrementVlcvxEpoch();
    }

    tx = await votiumStrategy.withdraw(unlockEpoch);
    await tx.wait();
    expect(await votiumStrategy.balanceOf(accounts[0].address)).eq(0);
  });
  it("Should allow multiple users to withdraw over two epochs", async function () {
    const stakerVotiumStrategy1 = votiumStrategy.connect(accounts[1]);
    const stakerVotiumStrategy2 = votiumStrategy.connect(accounts[2]);

    // mint for both accounts
    let tx = await stakerVotiumStrategy1.mint({
      value: ethers.utils.parseEther("1"),
    });
    await tx.wait();
    tx = await stakerVotiumStrategy2.mint({
      value: ethers.utils.parseEther("1"),
    });
    await tx.wait();

    await oracleApplyRewards(rewarderAccount, votiumStrategy.address);

    // burn half of balance for each address
    let unlockEpoch = await requestWithdrawal(
      stakerVotiumStrategy1,
      (await stakerVotiumStrategy1.balanceOf(accounts[1].address)).div(2)
    );
    unlockEpoch = await requestWithdrawal(
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
    tx = await stakerVotiumStrategy1.withdraw(unlockEpoch);
    await tx.wait();
    tx = await stakerVotiumStrategy2.withdraw(unlockEpoch);
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
    unlockEpoch = await requestWithdrawal(
      stakerVotiumStrategy1,
      await stakerVotiumStrategy1.balanceOf(accounts[1].address)
    );
    unlockEpoch = await requestWithdrawal(
      stakerVotiumStrategy2,
      await stakerVotiumStrategy2.balanceOf(accounts[2].address)
    );

    // pass enough epochs so the burned position is fully unlocked
    for (let i = 0; i < 17; i++) {
      await incrementVlcvxEpoch();
    }

    ethBalanceBefore1 = await ethers.provider.getBalance(accounts[1].address);
    ethBalanceBefore2 = await ethers.provider.getBalance(accounts[2].address);
    tx = await stakerVotiumStrategy1.withdraw(unlockEpoch);
    await tx.wait();
    tx = await stakerVotiumStrategy2.withdraw(unlockEpoch);
    await tx.wait();
    ethBalanceAfter1 = await ethers.provider.getBalance(accounts[1].address);
    ethBalanceAfter2 = await ethers.provider.getBalance(accounts[2].address); // balance after fully withdrawing is higher
    expect(ethBalanceAfter1).gt(ethBalanceBefore1);
    expect(ethBalanceAfter2).gt(ethBalanceBefore2);
    expect(await votiumStrategy.balanceOf(accounts[0].address)).eq(0);
  });
  it("Should never take more than 16 weeks to withdraw from the queue", async function () {
    let tx = await votiumStrategy.mint({
      value: ethers.utils.parseEther("1"),
    });
    await tx.wait();

    // burn half of balance
    const unlockEpoch = await requestWithdrawal(
      votiumStrategy,
      await votiumStrategy.balanceOf(accounts[0].address)
    );

    // pass enough epochs so the burned position is fully unlocked
    for (let i = 0; i < 16; i++) {
      await incrementVlcvxEpoch();
    }

    await expect(votiumStrategy.withdraw(unlockEpoch)).to.be.revertedWith(
      "Can't withdraw from future epoch"
    );
    await incrementVlcvxEpoch();

    tx = await votiumStrategy.withdraw(unlockEpoch);
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
  it("Should allow anyone apply rewards manually with depositRewards()", async function () {
    const depositAmount = ethers.utils.parseEther("100");
    const priceBeforeRewards = await votiumStrategy.price();

    const tx = await votiumStrategy.depositRewards(depositAmount, {
      value: depositAmount,
    });
    await tx.wait();

    const priceAfterRewards = await votiumStrategy.price();

    expect(priceAfterRewards).gt(priceBeforeRewards);
  });
});
