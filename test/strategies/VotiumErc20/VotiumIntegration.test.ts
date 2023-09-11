import { network, ethers, upgrades } from "hardhat";
import { VotiumErc20Strategy } from "../../../typechain-types";
import {
  getAdminAccount,
  getRewarderAccount,
  getUserAccounts,
  increaseTime1Epoch,
  randomStakeUnstakeWithdraw,
  sumRecord,
  totalEthRewarded,
  unstakingTimes,
  getTvl,
  requestWithdrawForUser,
  totalUserEthBalance,
  userTxFees,
} from "./IntegrationHelpers";
import { within3Percent } from "../../helpers/helpers";
import { expect } from "chai";
import { getCurrentEpoch } from "./VotiumTestHelpers";

const userCount = 6;
const epochCount = 66;
const userInteractionsPerEpoch = 2;

const startingEthBalances: any = [];

describe.skip("Votium integration test", async function () {
  let votiumStrategy: VotiumErc20Strategy;
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
      "VotiumErc20Strategy"
    );

    const ownerAccount = await getAdminAccount();
    const rewarderAccount = await getRewarderAccount();
    votiumStrategy = (await upgrades.deployProxy(votiumStrategyFactory, [
      ownerAccount.address,
      rewarderAccount.address,
      "0x0000000000000000000000000000000000000000", // TODO this should be an afEth mock but doesnt matter right now
    ])) as VotiumErc20Strategy;
    await votiumStrategy.deployed();

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
    const totalEthRewarded2 = totalUserBalances.sub(totalStartingBalances);

    // this varies so much (4% tolerance) because with each passing week something happens to the price of cvx in the LP
    // likely because its a TWAP so the price is changing a decent amount in these tests as weeks pass
    // in reality it should be  much lower variance
    console.log("totalEthRewarded", totalEthRewarded.toString());
    console.log("totalEthRewarded2", totalEthRewarded2.toString());
    console.log("totalGasFees", sumRecord(userTxFees).toString());
    expect(within3Percent(totalEthRewarded, totalEthRewarded2)).eq(true);
  });

  it("Should be able to predict how much each user earned in rewards based on how much they had staked each time rewards were distributed", async function () {
    // TODO
  });

  it("Should be able to predict total rewards earned systemwide based on total staked each time rewards were distributed", async function () {
    // TODO
  });

  it("Should have an average unlock time of less than 16 weeks", async function () {
    // TODO
  });

  it("Should never take more than 16 weeks to unlock", async function () {
    // TODO
  });

  it("Should have some positions that only took 1 week to unlock", async function () {
    // TODO
  });
});
