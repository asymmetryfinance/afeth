import { network, ethers, upgrades } from "hardhat";
import { VotiumErc20Strategy } from "../../../typechain-types";
import {
  getAdminAccount,
  getRewarderAccount,
  getUserAccounts,
  increaseTime1Epoch,
  randomStakeUnstakeWithdraw,
} from "./IntegrationHelpers";

describe("Votium integration test", async function () {
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
    const tx = await votiumStrategy.connect(await getAdminAccount()).mint({
      value: ethers.utils.parseEther("0.000001"),
    });
    await tx.wait();
  };

  before(
    async () => await resetToBlock(parseInt(process.env.BLOCK_NUMBER ?? "0"))
  );

  it.only("Should stake a random amount, request unstake random amount & withdraw any eligible amounts for random accounts every epoch for 64 epochs (4 lock periods)", async function () {
    const userAccounts = await getUserAccounts();
    for (let i = 0; i < 32; i++) {
      await randomStakeUnstakeWithdraw(
        userAccounts[0],
        votiumStrategy,
        ethers.utils.parseEther("10")
      );
      await increaseTime1Epoch(votiumStrategy);
    }
  });

  it("Should have tvl (or supply * price) be equal to total staked plus rewards minus unstaked", async function () {
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
