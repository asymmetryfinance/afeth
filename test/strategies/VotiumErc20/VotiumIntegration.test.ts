import { network, ethers, upgrades } from "hardhat";
import { VotiumErc20Strategy } from "../../../typechain-types";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

describe("Votium integration test", async function () {
  let votiumStrategy: VotiumErc20Strategy;
  let accounts: SignerWithAddress[];
  let rewarderAccount: SignerWithAddress;
  let userAccount: SignerWithAddress;
  let ownerAccount: SignerWithAddress;

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
    userAccount = accounts[0];
    rewarderAccount = accounts[1];
    ownerAccount = accounts[2];

    const votiumStrategyFactory = await ethers.getContractFactory(
      "VotiumErc20Strategy"
    );
    votiumStrategy = (await upgrades.deployProxy(votiumStrategyFactory, [
      ownerAccount.address,
      rewarderAccount.address,
    ])) as VotiumErc20Strategy;
    await votiumStrategy.deployed();

    // mint some to seed the system so totalSupply is never 0 (prevent price weirdness on withdraw)
    const tx = await votiumStrategy.connect(accounts[11]).mint({
      value: ethers.utils.parseEther("0.000001"),
    });
    await tx.wait();
  };

  before(
    async () => await resetToBlock(parseInt(process.env.BLOCK_NUMBER ?? "0"))
  );

  it("Should stake a random amount, request unstake random amount & withdraw any eligible amounts for random accounts every epoch for 64 epochs", async function () {
    // TODO
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
