import axios from "axios";
import { parseBalanceMap } from "../../merkle_helpers/parse-balance-map";
import { vlCvxAbi } from "../../abis/vlCvxAbi";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { votiumStashControllerAbi } from "../../abis/votiumStashControllerAbi";
import * as fs from 'fs';
import * as util from 'util';
import { ethers, network } from "hardhat";

export const epochDuration = 60 * 60 * 24 * 7;

export const updateRewardsMerkleRoot = async (
  votiumStrategyAddress: string
) => {
  console.log('updateRewardsMerkleRoot')
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

  console.log('about to load test data')
  const testData = await readJSONFromFile(
    "test/strategies/Votium/testData.json"
  );

  console.log('testData is', testData)
  // generate a merkle tree of rewards with our contract address and some other random addresses to make it realistic
  const proofData = testData.claimProofs;

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
      pd.claims[votiumStrategyAddress].index,
      pd.claims[votiumStrategyAddress].amount,
      pd.claims[votiumStrategyAddress].proof,
    ];
  });

  return { claimProofs, swapsData: testData.claimProofs };
};

// incremement time by 1 epoch and call await vlCvxContract.checkpointEpoch() so vlcv keeps working as time passes
// TODO make sure we are calling checkpoint epoch correctly and dont need to call any other functions
export const incrementVlcvxEpoch = async () => {
  console.log('incrementVlcvxEpoch1')
  const block = await ethers.provider.getBlock("latest");
  const blockTime = block.timestamp;
  const accounts = await ethers.getSigners();
  const vlCvxContract = new ethers.Contract(
    "0x72a19342e8F1838460eBFCCEf09F6585e32db86E",
    vlCvxAbi,
    accounts[0]
  );
  console.log('incrementVlcvxEpoch2')
  await time.increaseTo(blockTime + epochDuration);
  const tx = await vlCvxContract.checkpointEpoch();
  await tx.wait();
  console.log('incrementVlcvxEpoch3')
};

async function readJSONFromFile(filePath: string): Promise<any> {
  const readFile = util.promisify(fs.readFile);

  try {
    const content = await readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error('An error occurred while reading the file:', error);
    throw error;
  }
}
