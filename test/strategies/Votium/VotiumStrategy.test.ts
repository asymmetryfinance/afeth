import { network, ethers, upgrades } from "hardhat";
import { VotiumStrategy } from "../typechain-types";
import axios from "axios";
import { expect } from "chai";
import { votiumStashControllerAbi } from "../../abis/votiumStashControllerAbi";
import { vlCvxAbi } from "../../abis/vlCvxAbi";
import { BigNumber } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  generate0xSwapData,
  generateMockMerkleData,
  incrementVlcvxEpoch,
} from "./VotiumTestHelpers";

// Votium tests are hard for 2 reasons:
// 1) they require 2 types of oracle updates -- once a week to relock cvx and another every 2 weeks to claim rewards
// 2) We may need to impersonate accounts to update the merkle root and generate/simulate our own reward merkle proofs

describe("Test Votium Cvx Lock & Unlock Logic", async function () {
  let votiumStrategy: any;
  let accounts: any;

  before(async () => {
    accounts = await ethers.getSigners();

    const votiumStrategyFactory = await ethers.getContractFactory(
      "VotiumStrategy"
    );
    votiumStrategy = (await upgrades.deployProxy(votiumStrategyFactory, [
      accounts[0].address,
    ])) as VotiumStrategy;
    await votiumStrategy.deployed();
  });

  it("Should update values correctly if requestClose() is called followed by oracleRelockCvx() 17 weeks later", async function () {
    const mintTx = await votiumStrategy.mint({
      value: ethers.utils.parseEther("1"),
    });
    await mintTx.wait();

    const unlockTime0 = (await votiumStrategy.positions(0)).unlockTime;

    expect(unlockTime0).eq(0);

    const requestCloseTx = await votiumStrategy.requestClose(0);
    await requestCloseTx.wait();

    const firstRelockEpoch = await votiumStrategy.lastEpochLocksProcessed();
    const unlockTimeFinal = (await votiumStrategy.positions(0)).unlockTime;

    // wait 16 epochs and try to relock
    for (let i = 0; i < 16; i++) {
      await incrementVlcvxEpoch();
      const currentBlockTime = (await ethers.provider.getBlock()).timestamp;
      expect(currentBlockTime).lt(unlockTimeFinal);
    }

    await oracleRelockCvx();

    // 16 epochs isnt enough to be eligible to relock so it wont have relocked
    expect(await votiumStrategy.lastEpochLocksProcessed()).eq(firstRelockEpoch);

    expect(await votiumStrategy.cvxToLeaveUnlocked()).eq(0);

    // wait 1 more epoch and it will have unlocked so can be relocked
    await incrementVlcvxEpoch();
    await oracleRelockCvx();

    const currentBlockTime = (await ethers.provider.getBlock()).timestamp;
    // now it should be eligible for relock because some is unlockable
    expect(currentBlockTime).gt(unlockTimeFinal);

    const lastEpochLocksProcessed =
      await votiumStrategy.lastEpochLocksProcessed();
    const currentEpoch = await getCurrentEpoch();

    expect(await votiumStrategy.cvxToLeaveUnlocked()).gt(0);

    expect(lastEpochLocksProcessed).eq(currentEpoch);
    expect(lastEpochLocksProcessed).eq(
      BigNumber.from(firstRelockEpoch).add(17)
    );
  });

  const getCurrentEpoch = async () => {
    const accounts = await ethers.getSigners();
    const vlCvxContract = new ethers.Contract(
      "0x72a19342e8F1838460eBFCCEf09F6585e32db86E",
      vlCvxAbi,
      accounts[0]
    );
    return vlCvxContract.findEpochId(await getCurrentBlockTime());
  };

  const getCurrentBlockTime = async () => {
    const currentBlock = await ethers.provider.getBlock("latest");
    return currentBlock.timestamp;
  };

  const oracleRelockCvx = async () => {
    await votiumStrategy.oracleRelockCvx();
  };
});

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
    const votiumStashControllerAddress =
      "0x9d37A22cEc2f6b3635c61C253D192E68e85b1790";
    const votiumStashControllerOwner =
      "0xe39b8617D571CEe5e75e1EC6B2bb40DdC8CF6Fa3";
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [votiumStashControllerOwner],
    });
    const impersonatedOwnerSigner = await ethers.getSigner(
      votiumStashControllerOwner
    );
    const votiumStashController = new ethers.Contract(
      votiumStashControllerAddress,
      votiumStashControllerAbi,
      impersonatedOwnerSigner
    ) as any;

    // give owner some eth to do txs with
    const accounts = await ethers.getSigners();
    let tx = await accounts[0].sendTransaction({
      to: votiumStashControllerOwner,
      value: "2000000000000000000", // 2 eth
    });
    await tx.wait();

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

    // set root from new mocked merkle data
    for (let i = 0; i < tokenAddresses.length; i++) {
      const merkleRoot = proofData[tokenAddresses[i]].merkleRoot;
      await votiumStashController.multiFreeze([tokenAddresses[i]]);
      await votiumStashController.multiSet([tokenAddresses[i]], [merkleRoot]);
    }

    const claimProofs = tokenAddresses.map((_: any, i: number) => {
      const pd = proofData[tokenAddresses[i]];
      return [
        tokenAddresses[i],
        pd.claims[votiumStrategy.address].index,
        pd.claims[votiumStrategy.address].amount,
        pd.claims[votiumStrategy.address].proof,
      ];
    });

    tx = await votiumStrategy.mint({
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
    expect(ethBalanceAfter).gt(ethBalanceBefore);
  });
});
