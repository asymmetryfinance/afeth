import { network, ethers, upgrades } from "hardhat";
import { VotiumStrategy } from "../../../typechain-types";
import {
  getAdminAccount,
  getRewarderAccount,
  getUserAccounts,
  increaseTime1Epoch,
  randomStakeUnstakeWithdraw,
  sumRecord,
  totalEventEthRewarded,
  unstakingTimes,
  getTvl,
  requestWithdrawForUser,
  totalUserEthBalance,
  estimatedRewardInfo,
} from "./IntegrationHelpers";
import { within1Pip, within3Percent } from "../../helpers/helpers";
import { expect } from "chai";
import { getCurrentEpoch } from "./VotiumTestHelpers";
import { BigNumber } from "ethers";

const userCount = 6;
const epochCount = 66;
const userInteractionsPerEpoch = 2;

const startingEthBalances: any = [];

describe("Votium integration test", async function () {
  let votiumStrategy: VotiumStrategy;

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

    const votiumStrategyFactory = await ethers.getContractFactory(
      "VotiumStrategy"
    );

    const ownerAccount = await getAdminAccount();
    const rewarderAccount = await getRewarderAccount();
    votiumStrategy = (await upgrades.deployProxy(votiumStrategyFactory, [
      ownerAccount.address,
      rewarderAccount.address,
      ethers.constants.AddressZero, // TODO this should be an afEth mock but doesnt matter right now
    ])) as VotiumStrategy;
    await votiumStrategy.deployed();

    const chainLinkCvxEthFeedFactory = await ethers.getContractFactory(
      "ChainLinkCvxEthFeedMock"
    );
    const chainLinkCvxEthFeed = await chainLinkCvxEthFeedFactory.deploy();
    await votiumStrategy
      .connect(ownerAccount)
      .setChainlinkCvxEthFeed(chainLinkCvxEthFeed.address);

    const userAccounts = await getUserAccounts();
    for (let i = 0; i < userAccounts.length; i++) {
      const balance = await ethers.provider.getBalance(userAccounts[i].address);
      startingEthBalances.push(balance);
    }
  };

  before(
    async () => await resetToBlock(parseInt(process.env.BLOCK_NUMBER ?? "0"))
  );

  it("Should stake a random amount, request unstake random amount & withdraw any eligible amounts for random accounts every epoch for 66 epochs (4 lock periods + some epochs)", async function () {
    const userAccounts = await getUserAccounts();
    for (let i = 0; i < epochCount; i++) {
      // stake unstake & claim random amount for 2 (userInteractionsPerEpoch) users every epoch
      // cycle through 6 users (userCount)
      for (let j = 0; j < userInteractionsPerEpoch; j++) {
        await randomStakeUnstakeWithdraw(
          userAccounts[(i + j) % userCount],
          votiumStrategy,
          ethers.utils.parseEther("1")
        );
      }

      await increaseTime1Epoch(votiumStrategy);
    }
  });

  it("Should have tvl be equal to sum of all users tvl", async function () {
    const userAccounts = await getUserAccounts();
    const price = await votiumStrategy.price();
    const tvl = await getTvl(votiumStrategy);

    let totalUserBalances = ethers.BigNumber.from(0);

    for (let i = 0; i < userCount; i++) {
      const balance = await votiumStrategy.balanceOf(userAccounts[i].address);
      totalUserBalances = totalUserBalances.add(balance);
    }

    const totalTvl = totalUserBalances
      .mul(price)
      .div(ethers.utils.parseEther("1"));
    expect(tvl).equal(totalTvl);
  });

  it("Should request unstake, wait until eligible and unstake everything for all users", async function () {
    const userAccounts = await getUserAccounts();
    // request unstake for all users
    for (let i = 0; i < userCount; i++) {
      const userAcount = userAccounts[i];
      const balance = await votiumStrategy.balanceOf(userAcount.address);
      if (balance.eq(0)) {
        continue;
      } else {
        await requestWithdrawForUser(votiumStrategy, userAcount, balance);
      }
    }
    // got through next 17 epochs and get everything withdrawn for all users
    for (let i = 0; i < 17; i++) {
      const currentEpoch = await getCurrentEpoch();
      // try to withdraw on this epoch for each withdrawId for each user
      for (let j = 0; j < userCount; j++) {
        const userAcount = userAccounts[j];

        const withdrawIds = Object.keys(
          unstakingTimes[userAcount.address]
            ? unstakingTimes[userAcount.address]
            : []
        );
        for (let k = 0; k < withdrawIds.length; k++) {
          const withdrawId = parseInt(withdrawIds[k]);
          const unstakingTimeInfo =
            unstakingTimes[userAcount.address][withdrawId];

          if (
            unstakingTimeInfo &&
            !unstakingTimeInfo.withdrawn &&
            unstakingTimeInfo.epochEligible <= currentEpoch
          ) {
            await votiumStrategy.connect(userAcount).withdraw(withdrawId);
            unstakingTimes[userAcount.address][withdrawId].withdrawn = true;
          }
        }
      }

      // dont apply any rewards during these epochs
      // so it easy to calculate the users for the right rewards
      await increaseTime1Epoch(votiumStrategy, true);
    }

    const tvl = await getTvl(votiumStrategy);

    expect(tvl).equal(ethers.BigNumber.from(0));

    for (let i = 0; i < userCount; i++) {
      const userAcount = userAccounts[i];
      const ethBalance = await ethers.provider.getBalance(userAcount.address);
      const afEthBalance = await votiumStrategy.balanceOf(userAcount.address);
      expect(ethBalance).gt(startingEthBalances[i]);
      expect(afEthBalance).eq(0);
    }
  });

  it("Should have total rewards be roughly equal to sum of amounts from all DepositReward events", async function () {
    const totalStartingBalances = startingEthBalances.reduce(
      (acc: any, val: any) => acc.add(val),
      ethers.BigNumber.from(0)
    );
    const totalUserBalances = await totalUserEthBalance();
    const totalEthRewarded = totalUserBalances.sub(totalStartingBalances);

    // this varies so much (4% tolerance) because with each passing week something happens to the price of cvx in the LP
    // likely because its a TWAP so the price is changing a decent amount in these tests as weeks pass
    // in reality it should be  much lower variance
    expect(within3Percent(totalEventEthRewarded, totalEthRewarded)).eq(true);
  });

  it("Should be able to predict how much each user (and systemwide rewards) earned in rewards based on how much they had staked each time rewards were distributed", async function () {
    let totalRewardsEstimate = ethers.BigNumber.from(0);
    for (let i = 0; i < estimatedRewardInfo.length; i++) {
      const rewards = sumRecord(estimatedRewardInfo[i]);
      totalRewardsEstimate = totalRewardsEstimate.add(rewards);
    }
    const userAccounts = await getUserAccounts();

    let trueRewardSum = BigNumber.from(0);
    for (let i = 0; i < userCount; i++) {
      const userAcount = userAccounts[i];
      const ethBalance: any = await ethers.provider.getBalance(
        userAcount.address
      );

      const trueRewards = ethBalance.sub(startingEthBalances[i]);
      trueRewardSum = trueRewardSum.add(trueRewards);
    }

    expect(within1Pip(totalRewardsEstimate, totalEventEthRewarded)).eq(true);
    expect(within3Percent(totalEventEthRewarded, trueRewardSum)).eq(true);
    expect(within3Percent(totalRewardsEstimate, trueRewardSum)).eq(true);
  });

  it("Should have an average unlock time of less than 17 weeks, never more than 17 weeks", async function () {
    const byUserAddress = Object.values(unstakingTimes);

    let totalLength = 0;
    let unstakeCount = 0;
    for (let i = 0; i < byUserAddress.length; i++) {
      const values = Object.values(byUserAddress[i]);

      for (let j = 0; j < values.length; j++) {
        const unstakingLength =
          values[j].epochEligible - values[j].epochRequested;
        expect(unstakingLength).lte(17);
        totalLength += unstakingLength;
        unstakeCount++;
      }
    }

    const averageUnstakingLength = totalLength / unstakeCount;
    expect(averageUnstakingLength).lt(17);
    expect(averageUnstakingLength).gt(0);
    expect(averageUnstakingLength).eq(14.079710144927537); // this might change with new block numbers. not sure
  });
});
