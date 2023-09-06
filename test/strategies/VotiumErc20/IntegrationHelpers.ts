import { BigNumber } from "ethers";
import { ethers } from "hardhat";
import {
  getCurrentEpoch,
  incrementVlcvxEpoch,
  oracleApplyRewards,
  readJSONFromFile,
} from "./VotiumTestHelpers";
import { VotiumErc20Strategy } from "../../../typechain-types";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

type BalancesAtRewardEpochs = Record<number, BigNumber>;

// balance of each user account at each epoch when rewards were distributed
export const balancesAtRewardEpochs: BalancesAtRewardEpochs = {};

export type UserAddress = string;

export type Epoch = number;
export type UnstakeRequestTime = {
  epochRequested: number;
  epochEligible: number;
  withdrawn: boolean;
  withdrawId: number;
};

export const totalEthStaked: Record<UserAddress, BigNumber> = {};
export const totalEthUnStaked: Record<UserAddress, BigNumber> = {};
// all tx fees user spent staking & unstaking
export const userTxFees: Record<UserAddress, BigNumber> = {};

export const sumRecord = (record: Record<string, BigNumber>) => {
  let sum = BigNumber.from(0);
  for (let i = 0; i < Object.keys(record).length; i++) {
    const key = Object.keys(record)[i];
    sum = sum.add(record[key]);
  }
  return sum;
};

type UnstakingTimes = Record<UserAddress, Record<Epoch, UnstakeRequestTime>>;
// request time / eligible for withdraw tiem for all users and withdraw requests
export const unstakingTimes: UnstakingTimes = {};

let randomSeed = 2;

export let totalEthRewarded = BigNumber.from(0);

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
  return accounts[12];
};

export const getRewarderAccount = async () => {
  const accounts = await ethers.getSigners();
  return accounts[11];
};

// do everything that would happen on mainnet when time passes by 1 epoch
// call vlcvx checkpoint(), rewarder account claims rewards every other epoch, etc
export const increaseTime1Epoch = async (
  votiumStrategy: VotiumErc20Strategy
) => {
  await incrementVlcvxEpoch();

  const currentEpoch = await getCurrentEpoch();
  if (currentEpoch % 2 === 0) {
    console.log("applying rewards");
    const rewardEvent = await oracleApplyRewards(
      await getRewarderAccount(),
      votiumStrategy.address,
      // we use the small one (testDataSlippageSmall.json) because:
      // 1) we dont want it running out of rewards
      // 2) the big one (testData.json) will cause large slippage when compounded over many weeks withnout arb to balance it out
      // 3) its unrealistic to do such massive rewards with only a few users in the system
      await readJSONFromFile("./scripts/testDataSlippageSmall.json")
    );
    totalEthRewarded = totalEthRewarded.add(rewardEvent?.args?.ethAmount);
  }
};

export const randomStakeUnstakeWithdraw = async (
  userAcount: SignerWithAddress,
  votiumStrategy: VotiumErc20Strategy,
  maxStakeAmount: BigNumber
) => {
  const currentEpoch = await getCurrentEpoch();

  const stakeAmount = ethers.utils.parseEther(
    randomEthAmount(0, parseFloat(ethers.utils.formatEther(maxStakeAmount)))
  );

  let tx = await votiumStrategy.connect(userAcount).deposit({
    value: stakeAmount,
  });

  if (!totalEthStaked[userAcount.address])
    totalEthStaked[userAcount.address] = BigNumber.from(0);
  totalEthStaked[userAcount.address] =
    totalEthStaked[userAcount.address].add(stakeAmount);
  let mined = await tx.wait();
  let txFee = mined.gasUsed.mul(mined.effectiveGasPrice);

  if (!userTxFees[userAcount.address]) {
    userTxFees[userAcount.address] = BigNumber.from(0);
  }
  userTxFees[userAcount.address] = userTxFees[userAcount.address].add(txFee);

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
  userTxFees[userAcount.address] = userTxFees[userAcount.address].add(txFee);
  const event = mined?.events?.find((e: any) => e?.event === "WithdrawRequest");

  const withdrawId = event?.args?.withdrawId;
  const unlockEpoch = (
    await votiumStrategy.withdrawIdToWithdrawRequestInfo(withdrawId)
  ).epoch;

  if (!unstakingTimes[userAcount.address])
    unstakingTimes[userAcount.address] = {};
  unstakingTimes[userAcount.address][unlockEpoch.toNumber()] = {
    epochRequested: currentEpoch,
    epochEligible: unlockEpoch.toNumber(),
    withdrawn: false,
    withdrawId,
  };

  // check if there are any eligible withdraws
  for (
    let i = 0;
    i < Object.keys(unstakingTimes[userAcount.address]).length;
    i++
  ) {
    const key = parseInt(Object.keys(unstakingTimes[userAcount.address])[i]);

    if (unstakingTimes[userAcount.address][key].withdrawn) continue;
    const unstakeRequestTime = unstakingTimes[userAcount.address][key];
    if (currentEpoch.lt(unstakeRequestTime.epochEligible)) continue;

    const ethBalanceBeforeWithdraw = await ethers.provider.getBalance(
      userAcount.address
    );

    tx = await votiumStrategy
      .connect(userAcount)
      .withdraw(unstakeRequestTime.withdrawId);
    mined = await tx.wait();

    const ethBalanceAfterWithdraw = await ethers.provider.getBalance(
      userAcount.address
    );

    const txFee = mined.gasUsed.mul(mined.effectiveGasPrice);

    const balanceWithdrawn = ethBalanceAfterWithdraw
      .sub(ethBalanceBeforeWithdraw)
      .add(txFee);
    if (!totalEthUnStaked[userAcount.address])
      totalEthUnStaked[userAcount.address] = BigNumber.from(0);
    totalEthUnStaked[userAcount.address] =
      totalEthUnStaked[userAcount.address].add(balanceWithdrawn);

    userTxFees[userAcount.address] = userTxFees[userAcount.address].add(txFee);
    unstakingTimes[userAcount.address][key].withdrawn = true;
  }
};
