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
  totalEthStaked,
  totalEthUnStaked,
} from "./IntegrationHelpers";
import { within2Percent } from "../../helpers/helpers";
import { expect } from "chai";

const userCount = 6;
const epochCount = 66;
const userInteractionsPerEpoch = 2;

describe.only("Votium integration test", async function () {
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

    // mint some to seed the system so totalSupply is never 0 (prevent price weirdness on withdraw)
    const tx = await votiumStrategy.connect(await getAdminAccount()).deposit({
      value: ethers.utils.parseEther("0.000001"),
    });
    await tx.wait();
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

  it("Should have tvl (or supply * price) be equal to totalSaked plus rewards minus totalUnstaked", async function () {
    const totalSupply = await votiumStrategy.totalSupply();
    const price = await votiumStrategy.price();
    const tvl = totalSupply.mul(price).div(ethers.utils.parseEther("1"));
    const tvl2 = sumRecord(totalEthStaked)
      .add(totalEthRewarded)
      .sub(sumRecord(totalEthUnStaked));
    // this varies so much (2% tolerance) because with each passing week something happens to the price of cvx in the LP
    // likely because its a TWAP so the price is changing a decent amount in these tests as weeks pass
    // in reality it should be  much lower variance
    expect(within2Percent(tvl, tvl2)).equal(true);
  });

  // TODO check and understand why its not running out of reward tokens on claim? shul;dnt it be after like 15 (8 rewards) epochs?

  it("Should have tvl be equal to sum of all users tvl (balance * price)", async function () {
    // TODO
  });

  it("Should request unstake, wait until eligible and unstake everything for all users", async function () {
    // TODO
  });

  it("Should be able to predict how much each user earned in rewards based on how much they had staked each time rewards were distributed", async function () {
    // TODO
  });

  it("Should be able to predict total rewards earned systemwide based on total staked each time rewards were distributed", async function () {
    // TODO
  });

  it("Should have total rewards be equal to sum of amounts from all DepositReward events", async function () {
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
