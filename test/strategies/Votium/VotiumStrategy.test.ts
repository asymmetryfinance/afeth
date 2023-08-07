import { network, ethers, upgrades } from "hardhat";
import { VotiumStrategy } from "../typechain-types";
import axios from "axios";
import ERC20 from "@openzeppelin/contracts/build/contracts/ERC20.json";
import { expect } from "chai";
import { votiumStashControllerAbi } from "../../abis/votiumStashControllerAbi";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { vlCvxAbi } from "../../abis/vlCvxAbi";
import { BigNumber } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { generateMockMerkleData } from "./VotiumTestHelpers";

const epochDuration = 60 * 60 * 24 * 7;

// Votium tests are hard for 2 reasons:
// 1) they require 2 types of oracle updates -- once a week to relock cvx and another every 2 weeks to claim rewards
// 2) We may need to impersonate accounts to update the merkle root and generate/simulate our own reward merkle proofs

describe("Test Votium Rewards Logic", async function () {
  let votiumStrategy: any;

  let adminAccount: SignerWithAddress;
  beforeEach(async () => {
    const accounts = await ethers.getSigners();
    adminAccount = accounts[0];

    const votiumStrategyFactory = await ethers.getContractFactory(
      "VotiumStrategy"
    );
    votiumStrategy = (await upgrades.deployProxy(votiumStrategyFactory, [
      adminAccount.address,
    ])) as VotiumStrategy;
    await votiumStrategy.deployed();
  });

  it("Should be able to claim rewards after the first successful oracleClaimRewards() call", async function () {
    const mintTx = await votiumStrategy.mint({
      value: ethers.utils.parseEther("1"),
    });
    await mintTx.wait();

    const claimRewardsTx0 = await votiumStrategy.oracleClaimRewards();
    await claimRewardsTx0.wait();
  });
});

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

  // incremement time by 1 epoch and call await vlCvxContract.checkpointEpoch() so vlcv keeps working as time passes
  // TODO make sure we are calling checkpoint epoch correctly and dont need to call any other functions
  const incrementVlcvxEpoch = async () => {
    const block = await ethers.provider.getBlock("latest");
    const blockTime = block.timestamp;
    const accounts = await ethers.getSigners();
    const vlCvxContract = new ethers.Contract(
      "0x72a19342e8F1838460eBFCCEf09F6585e32db86E",
      vlCvxAbi,
      accounts[0]
    );
    await time.increaseTo(blockTime + epochDuration);
    const tx = await vlCvxContract.checkpointEpoch();
    await tx.wait();
  };

  const oracleRelockCvx = async () => {
    await votiumStrategy.oracleRelockCvx();
  };
});

// TODO change this to "Test oracleClaimRewards" (and implement 0x selling helpers) and make claimVotiumRewards() private
describe.only("Test claimVotiumRewards()", async function () {
  it("Should mock merkle data & impersonate account to set merkle root & claim rewards", async function () {
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
    const tx = await accounts[0].sendTransaction({
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
    const proofData = await generateMockMerkleData({
      [votiumStrategy.address]: "150",
      "0x8a65ac0E23F31979db06Ec62Af62b132a6dF4741": "160",
      "0x0000462df2438f7b39577917374b1565c306b908": "170",
      "0x000051d46ff97559ed5512ac9d2d95d0ef1140e1": "180",
    });

    const tokenAddresses = Object.keys(proofData);

    for (let i = 0; i < tokenAddresses.length; i++) {
      const merkleRoot = proofData[tokenAddresses[i]].merkleRoot;
      await votiumStashController.multiFreeze([tokenAddresses[i]]);
      await votiumStashController.multiSet([tokenAddresses[i]], [merkleRoot]);
    }

    console.log("tokenAddresses is", tokenAddresses);

    const claimProofs = tokenAddresses.map((_: any, i: number) => {
      const pd = proofData[tokenAddresses[i]];
      return [
        tokenAddresses[i],
        pd.claims[votiumStrategy.address].index,
        pd.claims[votiumStrategy.address].amount,
        pd.claims[votiumStrategy.address].proof,
      ];
    });

    const crvAddress = "0xD533a949740bb3306d119CC777fa900bA034cd52";
    const crvContract = new ethers.Contract(crvAddress, ERC20.abi, accounts[0]);
    const crvBalanceBeforeClaim = await crvContract.balanceOf(
      votiumStrategy.address
    );

    console.log("crvBalanceBeforeClaim", crvBalanceBeforeClaim.toString());

    const tx2 = await votiumStrategy.claimVotiumRewards(claimProofs);
    await tx2.wait();
    const crvBalanceAfterClaim = await crvContract.balanceOf(
      votiumStrategy.address
    );

    // TODO verify all balances went up
    expect(crvBalanceAfterClaim).gt(crvBalanceBeforeClaim);
  });
});

// TODO
// figure out some way to always use latest block but also use a valid token whale for that block
// this test is skipped because its always breaking because the whale balances change
describe.skip("Test selling votium rewards via 0x", async function () {
  let votiumStrategy: any;

  // mapping of token address to whale address
  const tokenWhales = {
    // ALCX
    "0xdbdb4d16eda451d0503b854cf79d55697f90c8df":
      "0x60457450ea6b05402e262df59a1b63539bd3403d",

    // CLEV
    "0x72953a5C32413614d24C29c84a66AE4B59581Bbf":
      "0xaf297dec752c909092a117a932a8ca4aaaff9795",

    // CNC
    "0x9aE380F0272E2162340a5bB646c354271c0F5cFC":
      "0x94dfce828c3daaf6492f1b6f66f9a1825254d24b",

    // CRV
    "0xD533a949740bb3306d119CC777fa900bA034cd52":
      "0x68bede1d0bc6be6d215f8f8ee4ee8f9fab97fe7a",

    // CVX
    "0x4e3fbd56cd56c3e72c1403e103b45db9da5b9d2b":
      "0x15a5f10cc2611bb18b18322e34eb473235efca39",

    // FXS
    "0x3432b6a60d23ca0dfca7761b7ab56459d9c964d0":
      "0xd53e50c63b0d549f142a2dcfc454501aaa5b7f3f",

    // GNO
    "0x6810e776880C02933D47DB1b9fc05908e5386b96":
      "0xa4a6a282a7fc7f939e01d62d884355d79f5046c1",

    // INV
    "0x41D5D79431A913C4aE7d69a668ecdfE5fF9DFB68":
      "0x4bef7e110d1a59a384220ede433fabd9aa2f4e06",

    // MET
    "0x2Ebd53d035150f328bd754D6DC66B99B0eDB89aa":
      "0xae362a72935dac355be989bf490a7d929f88c295",

    // OGV
    "0x9c354503C38481a7A7a51629142963F98eCC12D0":
      "0x1eb724a446ea4af61fb5f98ab15accd903583ccf",

    // SPELL
    "0x090185f2135308bad17527004364ebcc2d37e5f6":
      "0x7db408d4a2dee9da7cd8f45127badbaeac72ac29",

    // STG
    "0xaf5191b0de278c7286d6c7cc6ab6bb8a73ba2cd6":
      "0xd8d6ffe342210057bf4dcc31da28d006f253cef0",

    // TUSD
    "0x0000000000085d4780B73119b644AE5ecd22b376":
      "0x5ac8d87924255a30fec53793c1e976e501d44c78",

    // USDC
    "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48":
      "0x7713974908be4bed47172370115e8b1219f4a5f0",

    // USDD
    // "0x0C10bF8FcB7Bf5412187A595ab97a3609160b5c6":
    //   "0x44aa0930648738b39a21d66c82f69e45b2ce3b47",
  };

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
      "VotiumStrategy"
    );
    const accounts = await ethers.getSigners();

    votiumStrategy = (await upgrades.deployProxy(votiumStrategyFactory, [
      accounts[0].address,
    ])) as VotiumStrategy;
    await votiumStrategy.deployed();
  };

  before(async () => {
    const result = await axios.get(
      `https://api.etherscan.io/api?module=proxy&action=eth_blockNumber&apikey=${process.env.ETHERSCAN_API_KEY}`
    );
    // Because of dependence on 0x api
    // These tests needs to run close to the latest block
    await resetToBlock(Number(result.data.result) - 6);
  });

  it("Should send the contract erc20s (mock rewards) and sell them all with sellErc20s()", async function () {
    const accounts = await ethers.getSigners();

    const tokens = Object.keys(tokenWhales);
    const whales = Object.values(tokenWhales);

    // send the whales some eth so they can send tokens
    for (let i = 0; i < whales.length; i++) {
      await accounts[0].sendTransaction({
        to: whales[i],
        value: "100000000000000000",
      });
    }
    // send the token some of each reward token
    for (let i = 0; i < tokens.length; i++) {
      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [whales[i]],
      });
      const whaleSigner = await ethers.getSigner(whales[i]);
      const tokenContract = new ethers.Contract(
        tokens[i],
        ERC20.abi,
        whaleSigner
      );

      // special case for usdc 6 decimals
      const tokenAmount =
        tokens[i].toLowerCase() ===
        "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48".toLowerCase()
          ? "1000000"
          : "1000000000000000000"; // 1 token (assuming 1e18 = 1)
      await tokenContract.transfer(votiumStrategy.address, tokenAmount);
    }

    const swapsData = [];
    // swap reward tokens for eth
    for (let i = 0; i < tokens.length; i++) {
      const sellToken = tokens[i];
      const buyToken = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"; // weth

      // special case usdc 6 decimals
      const sellAmount =
        sellToken.toLowerCase() ===
        "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48".toLowerCase()
          ? "1000000"
          : "1000000000000000000"; // 1 token (assuming 1e18 = 1)

      // quote for cvx -> weth
      // TODO slippage protection
      const result = await axios.get(
        `https://api.0x.org/swap/v1/quote?buyToken=${buyToken}&sellToken=${sellToken}&sellAmount=${sellAmount}`,
        {
          headers: {
            "0x-api-key":
              process.env.API_KEY_0X || "35aa607c-1e98-4404-ad87-4bed10a538ae",
          },
        }
      );
      swapsData.push({
        sellToken,
        buyToken,
        spender: result.data.allowanceTarget,
        swapTarget: result.data.to,
        swapCallData: result.data.data,
      });
    }

    const erc20BalancesBefore = [];
    for (let i = 0; i < tokens.length; i++) {
      const tokenContract = new ethers.Contract(
        tokens[i],
        ERC20.abi,
        accounts[0]
      );
      erc20BalancesBefore.push(
        await tokenContract.balanceOf(votiumStrategy.address)
      );
    }
    const ethBalanceBefore = await ethers.provider.getBalance(
      votiumStrategy.address
    );
    const tx = await votiumStrategy.sellErc20s(swapsData);
    await tx.wait();

    const erc20BalancesAfter = [];
    for (let i = 0; i < tokens.length; i++) {
      const tokenContract = new ethers.Contract(
        tokens[i],
        ERC20.abi,
        accounts[0]
      );
      erc20BalancesAfter.push(
        await tokenContract.balanceOf(votiumStrategy.address)
      );
    }
    const ethBalanceAfter = await ethers.provider.getBalance(
      votiumStrategy.address
    );

    // check that it sold all erc20s in the strategy contract
    for (let i = 0; i < tokens.length; i++) {
      expect(erc20BalancesBefore[i]).to.be.gt(erc20BalancesAfter[i]);
      expect(erc20BalancesAfter[i]).to.be.eq(0);
    }

    // check that the strategy contract received eth
    expect(ethBalanceAfter).to.be.gt(ethBalanceBefore);
  });
});
