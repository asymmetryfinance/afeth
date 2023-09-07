import { network, ethers, upgrades } from "hardhat";
import { VotiumErc20Strategy } from "../../../typechain-types";
import {
  getAdminAccount,
  getRewarderAccount,
  getUserAccounts,
  increaseTime1Epoch,
  randomStakeUnstakeWithdraw,
  getTvl,
  requestWithdrawForUser,
  withdrawForUser,
} from "./IntegrationHelpers";

describe.only("Weird Behavior", async function () {
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
      value: ethers.utils.parseEther("0.1"),
    });
    await tx.wait();
  };

  before(
    async () => await resetToBlock(parseInt(process.env.BLOCK_NUMBER ?? "0"))
  );

  it("Should show price going up on withdraw. This is wrong", async function () {
    const userAccounts = await getUserAccounts();

    await randomStakeUnstakeWithdraw(
      userAccounts[0],
      votiumStrategy,
      ethers.utils.parseEther("1")
    );
    await increaseTime1Epoch(votiumStrategy);

    const balance = await votiumStrategy.balanceOf(userAccounts[0].address);
    await requestWithdrawForUser(votiumStrategy, userAccounts[0], balance);

    for (let i = 0; i < 17; i++) {
      await increaseTime1Epoch(votiumStrategy, true);
    }

    // THIS SHOULD NOT GO UP!!!!
    console.log(
      "price before withdraw",
      ethers.utils.formatEther(await votiumStrategy.price())
    );
    await withdrawForUser(votiumStrategy, userAccounts[0], 1);
    console.log(
      "price after withdraw",
      ethers.utils.formatEther(await votiumStrategy.price())
    );
  });
});
