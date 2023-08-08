import { network, ethers, upgrades } from "hardhat";
import { VotiumStrategy } from "../typechain-types";
import axios from "axios";
import { expect } from "chai";
import { votiumStashControllerAbi } from "../../abis/votiumStashControllerAbi";
import {
  generate0xSwapData,
  generateMockMerkleData,
  incrementVlcvxEpoch,
  updateRewardsMerkleRoot,
} from "./VotiumTestHelpers";

describe("Test Votium Rewards Logic", async function () {
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
  };

  before(async () => {
    const result = await axios.get(
      `https://api.etherscan.io/api?module=proxy&action=eth_blockNumber&apikey=${process.env.ETHERSCAN_API_KEY}`
    );
    // Because of dependence on 0x api
    // These tests needs to run close to the latest block
    await resetToBlock(Number(result.data.result) - 6);
  });

  it("Should mock merkle data, impersonate account to set merkle root, wait until claimable, claimRewards & sellRewards into eth", async function () {

    // give owner some eth to do txs with
    const accounts = await ethers.getSigners();

    const votiumStrategyFactory = await ethers.getContractFactory(
      "VotiumStrategy"
    );
    const votiumStrategy = (await upgrades.deployProxy(votiumStrategyFactory, [
      accounts[0].address,
    ])) as VotiumStrategy;
    await votiumStrategy.deployed();

    // generate a merkle tree of rewards with our contract address and some other random addresses to make it realistic
    const proofData = await generateMockMerkleData([
      votiumStrategy.address,
      "0x8a65ac0E23F31979db06Ec62Af62b132a6dF4741",
      "0x0000462df2438f7b39577917374b1565c306b908",
      "0x000051d46ff97559ed5512ac9d2d95d0ef1140e1",
      "0xc90c5cc170a8db4c1b66939e1a0bb9ad47c93602",
      "0x47CB53752e5dc0A972440dA127DCA9FBA6C2Ab6F",
      "0xe7ebef64f1ff602a28d8d37049e46d0ca77a38ac",
      "0x76a1f47f8d998d07a15189a07d9aada180e09ac6",
    ]);

    const tokenAddresses = Object.keys(proofData);

    await updateRewardsMerkleRoot(proofData);

    const claimProofs = tokenAddresses.map((_: any, i: number) => {
      const pd = proofData[tokenAddresses[i]];
      return [
        tokenAddresses[i],
        pd.claims[votiumStrategy.address].index,
        pd.claims[votiumStrategy.address].amount,
        pd.claims[votiumStrategy.address].proof,
      ];
    });

    let tx = await votiumStrategy.mint(0, {
      value: ethers.utils.parseEther("1"),
    });
    tx.wait();
    await incrementVlcvxEpoch();
    await incrementVlcvxEpoch();
    // should be allowed to claim every 2 epochs
    tx = await votiumStrategy.oracleClaimRewards(claimProofs);
    await tx.wait();

    // sell rewards
    const swapsData = await generate0xSwapData(
      tokenAddresses,
      votiumStrategy.address
    );
    const ethBalanceBefore = await ethers.provider.getBalance(
      votiumStrategy.address
    );
    tx = await votiumStrategy.oracleSellRewards(swapsData);
    await tx.wait();
    const ethBalanceAfter = await ethers.provider.getBalance(
      votiumStrategy.address
    );
    expect(ethBalanceAfter).gt(ethBalanceBefore as any);
  });
});
