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

  it("Should deploy votium contract", async function () {
    // TODO
  });

  it("Should mint votiumErc20 for user0", async function () {
    // TODO
  });

  it("Should distribute rewards and user0 tvl goes up accordingly", async function () {
    // TODO
  });

  it("Should mint votiumErc20 for user1", async function () {
    // TODO
  });

  it("Should distribute rewards and user0 and user1 tvl goes up accordingly", async function () {
    // TODO
  });
});
