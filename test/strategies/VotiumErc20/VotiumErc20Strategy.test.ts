import { network, ethers, upgrades } from "hardhat";
import { VotiumErc20Strategy } from "../typechain-types";
import { expect } from "chai";
import {
  incrementVlcvxEpoch,
  readJSONFromFile,
  updateRewardsMerkleRoot,
} from "../Votium/VotiumTestHelpers";

describe.only("Test VotiumErc20Strategy", async function () {
  let votiumStrategy: VotiumErc20Strategy;
  let accounts: any;
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
    votiumStrategy = (await upgrades.deployProxy(
      votiumStrategyFactory,
      []
    )) as VotiumErc20Strategy;
    await votiumStrategy.deployed();
  };

  before(
    async () => await resetToBlock(parseInt(process.env.BLOCK_NUMBER ?? "0"))
  );

  it("Should mint afEth tokens, burn tokens some tokens, apply rewards, pass time & process withdraw queue", async function () {
    let tx = await votiumStrategy.mint({
      value: ethers.utils.parseEther("2"),
    });
    await tx.wait();

    const afEthBalance1 = await votiumStrategy.balanceOf(accounts[0].address);
    const totalSupply1 = await votiumStrategy.totalSupply();

    expect(afEthBalance1).gt(0);
    expect(totalSupply1).eq(afEthBalance1);

    const testData = await readJSONFromFile("./scripts/testData.json");

    await updateRewardsMerkleRoot(
      testData.merkleRoots,
      testData.swapsData.map((sd: any) => sd.sellToken)
    );

    const claimProofs = testData.claimProofs;
    const swapsData = testData.swapsData;

    const priceBeforeRewards = await votiumStrategy.price();
    tx = await votiumStrategy.applyRewards(claimProofs, swapsData);
    await tx.wait();

    const priceAfterRewards = await votiumStrategy.price();

    expect(priceAfterRewards).gt(priceBeforeRewards);
    // burn
    await votiumStrategy.burn(
      await votiumStrategy.balanceOf(accounts[0].address)
    );

    // pass enough epochs so the burned position is fully unlocked
    for (let i = 0; i < 17; i++) {
      await incrementVlcvxEpoch();
    }

    const ethBalanceBefore = await ethers.provider.getBalance(
      accounts[0].address
    );

    tx = await votiumStrategy.processWithdrawQueue();
    await tx.wait();

    const ethBalanceAfter = await ethers.provider.getBalance(
      accounts[0].address
    );
    // balance after fully withdrawing is higher
    expect(ethBalanceAfter).gt(ethBalanceBefore);
  });
});
