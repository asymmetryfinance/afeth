import { BigNumber } from "ethers";
import { ethers } from "hardhat";
import {
  getCurrentEpoch,
  incrementVlcvxEpoch,
  oracleApplyRewards,
} from "./VotiumTestHelpers";
import { VotiumErc20Strategy } from "../../../typechain-types";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

type BalancesAtRewardEpochs = Record<number, BigNumber>;

// balance of each user account at each epoch when rewards were distributed
export const balancesAtRewardEpochs: BalancesAtRewardEpochs = {};

export type UserAddress = string;

export type UnstakeRequestTime = {
  epochRequested: number;
  epochEligible: number;
};

type UnstakingTimes = Record<UserAddress, UnstakeRequestTime[]>;
// request time / eligible for withdraw tiem for all users and withdraw requests
export const unstakingTimes: UnstakingTimes = {};

// all tx fees user spent staking & unstaking
export const userTxFees: Record<UserAddress, BigNumber[]> = {};
let randomSeed = 2;

export const randomEthAmount = (min: number, max: number) => {
  return (min + deterministicRandom() * (max - min)).toFixed(18);
};

// For deterministic (seeded) random values in tests
const deterministicRandom = () => {
  const x = Math.sin(randomSeed++) * 10000;
  return x - Math.floor(x);
};

export const getUserAccounts = async () => {
  const accounts = await ethers.getSigners();

  return accounts.slice(2, accounts.length);
};

export const getAdminAccount = async () => {
  const accounts = await ethers.getSigners();
  return accounts[0];
};

export const getRewarderAccount = async () => {
  const accounts = await ethers.getSigners();
  return accounts[1];
};

// do everything that would happen on mainnet when time passes by 1 epoch
// call vlcvx checkpoint(), rewarder account claims rewards every other epoch, etc
export const increaseTime1Epoch = async (
  votiumStrategy: VotiumErc20Strategy
) => {
  await incrementVlcvxEpoch();

  const currentEpoch = await getCurrentEpoch();
  if (currentEpoch % 2 === 0) {
    await oracleApplyRewards(
      await getRewarderAccount(),
      votiumStrategy.address
    );
  }
};

export const randomStakeUnstakeWithdraw = async (
  userAcount: SignerWithAddress,
  votiumStrategy: VotiumErc20Strategy,
  maxStakeAmount: BigNumber
) => {
  const stakeAmount = randomEthAmount(
    0,
    parseFloat(ethers.utils.formatEther(maxStakeAmount))
  );

  let tx = await votiumStrategy.connect(userAcount).mint({
    value: ethers.utils.parseEther(stakeAmount),
  });
  let mined = await tx.wait();
  let txFee = mined.gasUsed.mul(mined.effectiveGasPrice);

  if (!userTxFees[userAcount.address]) userTxFees[userAcount.address] = [];
  userTxFees[userAcount.address].push(txFee);

  const votiumBalance = await votiumStrategy.balanceOf(userAcount.address);

  const withdrawAmount = randomEthAmount(
    0,
    parseFloat(ethers.utils.formatEther(votiumBalance))
  );

  tx = await votiumStrategy
    .connect(userAcount)
    .requestWithdraw(ethers.utils.parseEther(withdrawAmount));
  mined = await tx.wait();
  txFee = mined.gasUsed.mul(mined.effectiveGasPrice);
  userTxFees[userAcount.address].push(txFee);
  const event = mined?.events?.find((e) => e?.event === "WithdrawRequest");

  const unlockEpoch = event?.args?.unlockEpoch;

  if (!unstakingTimes[userAcount.address])
    unstakingTimes[userAcount.address] = [];
  unstakingTimes[userAcount.address].push({
    epochRequested: await getCurrentEpoch(),
    epochEligible: unlockEpoch,
  });

  // check if there are any eligible withdraws

  for (let i = 0; i < unstakingTimes[userAcount.address].length; i++) {
    console.log('looping', i);
    const unstakeRequestTime = unstakingTimes[userAcount.address][i];

    console.log('unstakeRequestTime', unstakeRequestTime);
    if (unstakeRequestTime.epochEligible <= (await getCurrentEpoch())) {
        console.log('about to do tx')
      tx = await votiumStrategy
        .connect(userAcount)
        .withdraw(unstakeRequestTime.epochEligible);
        console.log('babam')
      mined = await tx.wait();
      txFee = mined.gasUsed.mul(mined.effectiveGasPrice);
      userTxFees[userAcount.address].push(txFee);
    }
  }
};
