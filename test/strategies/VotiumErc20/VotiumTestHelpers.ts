import { ethers, network } from "hardhat";
import { vlCvxAbi } from "../../abis/vlCvxAbi";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { votiumStashControllerAbi } from "../../abis/votiumStashControllerAbi";
import * as fs from "fs";
import * as util from "util";
import { BigNumber } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import {
  votiumClaimRewards,
  votiumSellRewards,
} from "../../../scripts/applyVotiumRewardsHelpers";
import { VotiumErc20Strategy } from "../../../typechain-types";

export const epochDuration = 60 * 60 * 24 * 7;
export const vlCvxAddress = "0x72a19342e8F1838460eBFCCEf09F6585e32db86E";

export const updateRewardsMerkleRoot = async (
  merkleRoots: string[],
  tokenAddresses: string[]
) => {
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

  // set root from new mocked merkle data
  for (let i = 0; i < tokenAddresses.length; i++) {
    const merkleRoot = merkleRoots[i];
    await votiumStashController.multiFreeze([tokenAddresses[i]]);
    await votiumStashController.multiSet([tokenAddresses[i]], [merkleRoot]);
  }
};

// incremement time by 1 epoch and call await vlCvxContract.checkpointEpoch() so vlcv keeps working as time passes
export const incrementVlcvxEpoch = async () => {
  const block = await ethers.provider.getBlock("latest");
  const blockTime = block.timestamp;
  const accounts = await ethers.getSigners();
  const vlCvxContract = new ethers.Contract(
    vlCvxAddress,
    vlCvxAbi,
    accounts[9]
  );
  await time.increaseTo(blockTime + epochDuration);
  const tx = await vlCvxContract.checkpointEpoch();
  await tx.wait();
};

export async function readJSONFromFile(filePath: string): Promise<any> {
  const readFile = util.promisify(fs.readFile);

  try {
    const content = await readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    console.error("An error occurred while reading the file:", error);
    throw error;
  }
}

export const getCurrentEpoch = async () => {
  const accounts = await ethers.getSigners();
  const vlCvxContract = new ethers.Contract(
    vlCvxAddress,
    vlCvxAbi,
    accounts[0]
  );
  return vlCvxContract.findEpochId(await getCurrentBlockTime());
};

export const getCurrentBlockTime = async () => {
  const currentBlock = await ethers.provider.getBlock("latest");
  return currentBlock.timestamp;
};

export const getEpochStartTime = async (epoch: number) => {
  const accounts = await ethers.getSigners();
  const vlCvxContract = new ethers.Contract(
    vlCvxAddress,
    vlCvxAbi,
    accounts[0]
  );
  return BigNumber.from((await vlCvxContract.epochs(epoch)).date);
};

export const getCurrentEpochStartTime = async () => {
  return getEpochStartTime(await getCurrentEpoch());
};

export const getCurrentEpochEndTime = async () => {
  return (await getCurrentEpochStartTime()).add(epochDuration - 1);
};

export const getNextEpochStartTime = async () => {
  return getEpochStartTime((await getCurrentEpoch()).add(1));
};

export const oracleApplyRewards = async (
  account: SignerWithAddress,
  votiumStrategyAddress: string,
  testDataOverride?: string
) => {
  const testData =
    testDataOverride || (await readJSONFromFile("./scripts/testData.json"));
  await updateRewardsMerkleRoot(
    testData.merkleRoots,
    testData.swapsData.map((sd: any) => sd.sellToken)
  );
  await votiumClaimRewards(
    account,
    votiumStrategyAddress,
    testData.claimProofs
  );
  const sellEvent = await votiumSellRewards(
    account,
    votiumStrategyAddress,
    [],
    testData.swapsData
  );
  return sellEvent;
};

export const requestWithdrawal = async (
  votiumStrategy: VotiumErc20Strategy,
  amount: BigNumber
): Promise<string> => {
  const tx = await votiumStrategy.requestWithdraw(amount);
  const mined = await tx.wait();
  const event = mined?.events?.find((e: any) => e?.event === "WithdrawRequest");
  return event?.args?.withdrawId;
};
