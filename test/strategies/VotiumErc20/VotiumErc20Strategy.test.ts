import { network, ethers, upgrades } from "hardhat";
import { VotiumErc20Strategy } from "../../../typechain-types";
import { expect } from "chai";
import {
  incrementVlcvxEpoch,
  readJSONFromFile,
  updateRewardsMerkleRoot,
} from "./VotiumTestHelpers";
import { BigNumber } from "ethers";
import {
  votiumClaimRewards,
  votiumSellRewards,
} from "../../../scripts/applyVotiumRewardsHelpers";
import { within1Percent } from "../../helpers/helpers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

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

    const testData = await readJSONFromFile("./scripts/testData.json");

    await updateRewardsMerkleRoot(
      testData.merkleRoots,
      testData.swapsData.map((sd: any) => sd.sellToken)
    );

    const priceBeforeRewards = await votiumStrategy.price();

    await votiumClaimRewards(
      rewarderAccount,
      votiumStrategy.address,
      testData.claimProofs
    );
    await votiumSellRewards(
      rewarderAccount,
      votiumStrategy.address,
      [],
      testData.swapsData
    );

    const priceAfterRewards = await votiumStrategy.price();

    expect(priceAfterRewards).gt(priceBeforeRewards);

    // burn
    tx = await votiumStrategy.requestWithdraw(
      await votiumStrategy.balanceOf(accounts[0].address)
    );
    const mined = await tx.wait();

    const event = mined?.events?.find((e) => e?.event === "WithdrawRequest");

    const unlockEpoch = event?.args?.unlockEpoch;

    // pass enough epochs so the burned position is fully unlocked
    for (let i = 0; i < 17; i++) {
      await incrementVlcvxEpoch();
    }

    const ethBalanceBefore = await ethers.provider.getBalance(
      accounts[0].address
    );

    tx = await votiumStrategy.withdraw(unlockEpoch);
    await tx.wait();

    const ethBalanceAfter = await ethers.provider.getBalance(
      accounts[0].address
    );
    // balance after fully withdrawing is higher
    expect(ethBalanceAfter).gt(ethBalanceBefore);
  });
  it("Should mint afEth tokens, burn tokens some tokens, apply rewards, pass time & process withdraw queue for multiple accounts", async function () {
    const startingTotalSupply = await votiumStrategy.totalSupply();
    const stakerAmounts = 2;

    let tx;
    let runningBalance = BigNumber.from(startingTotalSupply);
    for (let i = 1; i <= stakerAmounts; i++) {
      const stakerVotiumStrategy = votiumStrategy.connect(accounts[i]);
      tx = await stakerVotiumStrategy.mint({
        value: ethers.utils.parseEther("1"),
      });
      await tx.wait();
      const afEthBalance = await votiumStrategy.balanceOf(accounts[i].address);
      runningBalance = runningBalance.add(afEthBalance);
    }

    const totalSupply1 = await votiumStrategy.totalSupply();
    expect(totalSupply1).eq(runningBalance);

    // claim rewards
    const testData = await readJSONFromFile("./scripts/testData.json");

    await updateRewardsMerkleRoot(
      testData.merkleRoots,
      testData.swapsData.map((sd: any) => sd.sellToken)
    );

    const priceBeforeRewards = await votiumStrategy.price();

    await votiumClaimRewards(
      rewarderAccount,
      votiumStrategy.address,
      testData.claimProofs
    );
    await votiumSellRewards(
      rewarderAccount,
      votiumStrategy.address,
      [],
      testData.swapsData
    );

    const priceAfterRewards = await votiumStrategy.price();

    expect(priceAfterRewards).gt(priceBeforeRewards);
    expect(
      within1Percent(
        await votiumStrategy.balanceOf(accounts[1].address),
        await votiumStrategy.balanceOf(accounts[2].address)
      )
    ).eq(true);

    // request withdraw for each account
    let unlockEpoch;
    for (let i = 1; i <= stakerAmounts; i++) {
      const stakerVotiumStrategy = votiumStrategy.connect(accounts[i]);
      tx = await stakerVotiumStrategy.requestWithdraw(
        await stakerVotiumStrategy.balanceOf(accounts[i].address)
      );
      const mined = await tx.wait();
      const event = mined?.events?.find((e) => e?.event === "WithdrawRequest");
      unlockEpoch = event?.args?.unlockEpoch;

      const unlock = await votiumStrategy.unlockQueues(
        accounts[i].address,
        unlockEpoch
      );
      expect(unlock.afEthOwed).gt(0);
    }

    // go to next epoch
    for (let i = 0; i < 17; i++) {
      await incrementVlcvxEpoch();
    }

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
      tx = await stakerVotiumStrategy.withdraw(unlockEpoch);
      await tx.wait();

      const ethBalanceAfter = await ethers.provider.getBalance(
        accounts[i].address
      );
      balancesAfter.push(ethBalanceAfter);
      // balance after fully withdrawing is higher
      expect(ethBalanceAfter).gt(ethBalanceBefore);
    }

    // verify balances are within 1% of each other
    for (let i = 0; i < stakerAmounts; i++) {
      expect(within1Percent(balancesBefore[i], balancesAfter[i])).eq(true);
    }
  });
  it("Should show 2 accounts receive the same rewards during different epochs", async function () {
    const stakeAmount = ethers.utils.parseEther("10");
    console.log(
      accounts[0].address,
      votiumStrategy.address,
      accounts[2].address
    );

    const stakerVotiumStrategy1 = votiumStrategy.connect(accounts[1]);
    const stakerVotiumStrategy2 = votiumStrategy.connect(accounts[2]);

    // first account mints before rewards are claimed
    let tx = await stakerVotiumStrategy1.mint({
      value: stakeAmount,
    });
    await tx.wait();

    // claim rewards
    const testData = await readJSONFromFile("./scripts/testData.json");

    const priceBeforeRewards = await votiumStrategy.price();
    console.log({ priceBeforeRewards });

    // Claim rewards
    await updateRewardsMerkleRoot(
      testData.merkleRoots,
      testData.swapsData.map((sd: any) => sd.sellToken)
    );
    await votiumClaimRewards(
      rewarderAccount,
      votiumStrategy.address,
      testData.claimProofs
    );
    await votiumSellRewards(
      rewarderAccount,
      votiumStrategy.address,
      [],
      testData.swapsData
    );

    const priceAfterRewardsBeforeSecondStake = await votiumStrategy.price();
    console.log({ priceAfterRewardsBeforeSecondStake });

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
    await updateRewardsMerkleRoot(
      testData.merkleRoots,
      testData.swapsData.map((sd: any) => sd.sellToken)
    );
    await votiumClaimRewards(
      rewarderAccount,
      votiumStrategy.address,
      testData.claimProofs
    );
    await votiumSellRewards(
      rewarderAccount,
      votiumStrategy.address,
      [],
      testData.swapsData
    );

    const priceAfterAllRewards = await votiumStrategy.price();
    expect(priceAfterAllRewards).gt(priceAfterRewardsAfterSecondStake);
    console.log({ priceAfterAllRewards });
    console.log(
      "Balance 1",
      await stakerVotiumStrategy1.balanceOf(accounts[1].address)
    );
    console.log(
      "Balance 2",
      await stakerVotiumStrategy1.balanceOf(accounts[2].address)
    );
    // request withdraw for each account
    await stakerVotiumStrategy1.requestWithdraw(
      await stakerVotiumStrategy1.balanceOf(accounts[1].address)
    );
    tx = await stakerVotiumStrategy2.requestWithdraw(
      await stakerVotiumStrategy1.balanceOf(accounts[2].address)
    );
    const mined = await tx.wait();
    const event = mined?.events?.find((e) => e?.event === "WithdrawRequest");
    const unlockEpoch = event?.args?.unlockEpoch;

    // go to next epoch
    for (let i = 0; i < 17; i++) {
      await incrementVlcvxEpoch();
    }

    // withdraw from queue
    // pass enough epochs so the burned position is fully unlocked
    const ethBalanceBefore1 = await ethers.provider.getBalance(
      accounts[1].address
    );
    console.log("PRICE BEFORE WITHDRAW:", await votiumStrategy.price());

    tx = await stakerVotiumStrategy1.withdraw(unlockEpoch);
    await tx.wait();
    console.log("PRICE AFTER FIRST WITHDRAW:", await votiumStrategy.price());
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
    console.log("PRICE AFTER SECOND WITHDRAW:", await votiumStrategy.price());

    const ethBalanceAfter2 = await ethers.provider.getBalance(
      accounts[2].address
    );
    // balance after fully withdrawing is higher
    expect(ethBalanceAfter2).gt(ethBalanceBefore2);
    const rewardAmount2 = ethBalanceAfter2
      .sub(ethBalanceBefore2)
      .sub(stakeAmount);
    console.log({
      ethBalanceBefore1,
      ethBalanceAfter1,
      ethBalanceBefore2,
      ethBalanceAfter2,
    });
    console.log({ rewardAmount1, rewardAmount2 });

    // amount of rewards sent to account
    // rewardsGained.push(ethBalanceAfter.sub(ethBalanceBefore).sub(stakeAmount));
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

    // claim rewards
    const testData = await readJSONFromFile("./scripts/testData.json");

    await updateRewardsMerkleRoot(
      testData.merkleRoots,
      testData.swapsData.map((sd: any) => sd.sellToken)
    );

    const priceBeforeRewards = await votiumStrategy.price();

    await votiumClaimRewards(
      rewarderAccount,
      votiumStrategy.address,
      testData.claimProofs
    );
    await votiumSellRewards(
      rewarderAccount,
      votiumStrategy.address,
      [],
      testData.swapsData
    );

    const priceAfterRewards = await votiumStrategy.price();

    expect(priceAfterRewards).gt(priceBeforeRewards);

    // request withdraw for each account
    let unlockEpoch;
    for (let i = 1; i <= stakerAmounts; i++) {
      const stakerVotiumStrategy = votiumStrategy.connect(accounts[i]);
      tx = await stakerVotiumStrategy.requestWithdraw(
        await stakerVotiumStrategy.balanceOf(accounts[i].address)
      );
      const mined = await tx.wait();
      const event = mined?.events?.find((e) => e?.event === "WithdrawRequest");
      unlockEpoch = event?.args?.unlockEpoch;

      const unlock = await votiumStrategy.unlockQueues(
        accounts[i].address,
        unlockEpoch
      );
      expect(unlock.afEthOwed).gt(0);
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
      tx = await stakerVotiumStrategy.withdraw(unlockEpoch);
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
    const stakeAmount = ethers.utils.parseEther("4");

    let tx;
    let runningBalance = BigNumber.from(startingTotalSupply);
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
    const testData = await readJSONFromFile("./scripts/testData.json");

    await updateRewardsMerkleRoot(
      testData.merkleRoots,
      testData.swapsData.map((sd: any) => sd.sellToken)
    );

    const priceBeforeRewards = await votiumStrategy.price();

    await votiumClaimRewards(
      rewarderAccount,
      votiumStrategy.address,
      testData.claimProofs
    );
    await votiumSellRewards(
      rewarderAccount,
      votiumStrategy.address,
      [],
      testData.swapsData
    );

    const priceAfterRewards = await votiumStrategy.price();

    expect(priceAfterRewards).gt(priceBeforeRewards);

    // request withdraw for each account
    let unlockEpoch;
    for (let i = 1; i <= stakerAmounts; i++) {
      const stakerVotiumStrategy = votiumStrategy.connect(accounts[i]);
      tx = await stakerVotiumStrategy.requestWithdraw(
        await stakerVotiumStrategy.balanceOf(accounts[i].address)
      );
      const mined = await tx.wait();
      const event = mined?.events?.find((e) => e?.event === "WithdrawRequest");
      unlockEpoch = event?.args?.unlockEpoch;

      const unlock = await votiumStrategy.unlockQueues(
        accounts[i].address,
        unlockEpoch
      );
      expect(unlock.afEthOwed).gt(0);
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
      tx = await stakerVotiumStrategy.withdraw(unlockEpoch);
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
  it("Should show an account staked for twice as long receive twice as many rewards as another", async function () {
    // TODO
  });
  it("Should show an account staked for twice as long receive twice as many rewards as another", async function () {
    // TODO
  });
  it("Should increase price proportionally to how much rewards were added vs tvl", async function () {
    // TODO
  });
  it("Should increase price twice as much when depositing twice as much rewards", async function () {
    // TODO
  });
  it("Should allow owner to withdraw stuck tokens with withdrawStuckTokens()", async function () {
    // TODO
  });
  it("Should allow anyone apply rewards manually with depositRewards()", async function () {
    // TODO
  });
  it("Should allow 1 user to withdraw over two epochs", async function () {
    // TODO
  });
  it("Should allow multiple users to withdraw over two epochs", async function () {
    // TODO
  });
  it("Should allow multiple users to withdraw over multiple epochs", async function () {
    // TODO
  });
  it("Should never take more than 16 weeks to withdraw from the queue", async function () {
    // TODO
  });
});
