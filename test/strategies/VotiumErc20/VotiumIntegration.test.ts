import { network, ethers, upgrades } from "hardhat";
import { VotiumErc20Strategy } from "../../../typechain-types";
import {
  getAdminAccount,
  getRewarderAccount,
  getUserAccounts,
  increaseTime1Epoch,
  randomStakeUnstakeWithdraw,
  totalEthRewarded,
  totalEthStaked,
  totalEthUnStaked,
  userTxFees,
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
    const tx = await votiumStrategy.connect(await getAdminAccount()).deposit({
      value: ethers.utils.parseEther("0.000001"),
    });
    await tx.wait();
  };

  before(
    async () => await resetToBlock(parseInt(process.env.BLOCK_NUMBER ?? "0"))
  );

  it.only("Should stake a random amount, request unstake random amount & withdraw any eligible amounts for random accounts every epoch for 64 epochs (4 lock periods)", async function () {
    const userAccounts = await getUserAccounts();
    for (let i = 0; i < 35; i++) {
      console.log("epoch", i);
      await randomStakeUnstakeWithdraw(
        userAccounts[i % 4],
        votiumStrategy,
        ethers.utils.parseEther("10")
      );
      await randomStakeUnstakeWithdraw(
        userAccounts[(i + 1) % 4],
        votiumStrategy,
        ethers.utils.parseEther("10")
      );

      console.log("increasing epoch time");
      await increaseTime1Epoch(votiumStrategy);
      console.log("done");
    }
  });

  it("Should have tvl (or supply * price) be equal to total staked plus rewards minus unstaked plus tx fees", async function () {
    const totalSupply = await votiumStrategy.totalSupply();
    const price = await votiumStrategy.price();

    const tvl = totalSupply.mul(price).div(ethers.utils.parseEther("1"));

    console.log("totalSupply", totalSupply.toString());
    console.log("price", price.toString());
    console.log("tvl", tvl.toString());

    console.log("userTxFees", userTxFees.toString());

    console.log("totalEthRewarded", totalEthRewarded.toString());

    console.log("totalEthStaked", totalEthStaked.toString());
    console.log("totalEthUnStaked", totalEthUnStaked.toString());
  });

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
