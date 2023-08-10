import { network, ethers, upgrades } from "hardhat";
import { VotiumStrategy } from "../typechain-types";
import { expect } from "chai";

describe("Test Votium Rewards Logic", async function () {
  let votiumStrategy: VotiumStrategy;
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
      "VotiumStrategy"
    );
    votiumStrategy = (await upgrades.deployProxy(votiumStrategyFactory, [
      accounts[0].address,
    ])) as VotiumStrategy;
    await votiumStrategy.deployed();
  };

  before(
    async () => await resetToBlock(parseInt(process.env.BLOCK_NUMBER ?? "0"))
  );

  it("Should fail to mint the same tokenId twice", async function () {
    const ownerAddress = accounts[0].address;
    const tx = await votiumStrategy.mint(0, ownerAddress, {
      value: ethers.utils.parseEther("1"),
    });
    tx.wait();
    await expect(
      votiumStrategy.mint(0, ownerAddress, {
        value: ethers.utils.parseEther("1"),
      })
    ).to.be.revertedWith("Already Exists");
  });
});
