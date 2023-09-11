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

export type WithdrawId = number;
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

type UnstakingTimes = Record<
  UserAddress,
  Record<WithdrawId, UnstakeRequestTime>
>;
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

export type EpochRewardInfo = {
  expectedUserRewardAmounts: Record<UserAddress, BigNumber>; // how much eth each user is expected to receive from the reward based on their current balance vs totalSupply
};

// info about all stake balances each time rewards are applied. we we can calculate the rewards for each user
const epochRewardInfo: EpochRewardInfo[] = [];

// do everything that would happen on mainnet when time passes by 1 epoch
// call vlcvx checkpoint(), rewarder account claims rewards every other epoch, etc
export const increaseTime1Epoch = async (
  votiumStrategy: VotiumErc20Strategy,
  noRewards: boolean = false
) => {
  await incrementVlcvxEpoch();

  const currentEpoch = await getCurrentEpoch();
  if (!noRewards && currentEpoch % 2 === 0) {
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

    epochRewardInfo.push({
      expectedUserRewardAmounts: {}, // TODO
    });
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

  await depositForUser(votiumStrategy, userAcount, stakeAmount);

  const votiumBalance = await votiumStrategy.balanceOf(userAcount.address);

  const randomVotiumAmount = ethers.utils.parseEther(
    randomEthAmount(0, parseFloat(ethers.utils.formatEther(votiumBalance)))
  );
  await requestWithdrawForUser(votiumStrategy, userAcount, randomVotiumAmount);

  const withdrawIds = Object.keys(unstakingTimes[userAcount.address]);
  // check if there are any eligible withdraws
  for (let i = 0; i < withdrawIds.length; i++) {
    const withdrawId = parseInt(withdrawIds[i]);
    if (unstakingTimes[userAcount.address][withdrawId].withdrawn) continue;
    const unstakeRequestTime = unstakingTimes[userAcount.address][withdrawId];
    if (currentEpoch.lt(unstakeRequestTime.epochEligible)) continue;
    await withdrawForUser(votiumStrategy, userAcount, withdrawId);
  }
};

export const getTvl = async (votiumStrategy: VotiumErc20Strategy) => {
  const totalSupply = await votiumStrategy.totalSupply();
  const price = await votiumStrategy.price();
  return totalSupply.mul(price).div(ethers.utils.parseEther("1"));
};

export const depositForUser = async (
  votiumStrategy: VotiumErc20Strategy,
  userAcount: SignerWithAddress,
  withdrawAmount: BigNumber
) => {
  const stakeAmount = ethers.utils.parseEther(
    randomEthAmount(0, parseFloat(ethers.utils.formatEther(withdrawAmount)))
  );

  const tx = await votiumStrategy.connect(userAcount).deposit({
    value: stakeAmount,
  });

  if (!totalEthStaked[userAcount.address])
    totalEthStaked[userAcount.address] = BigNumber.from(0);
  totalEthStaked[userAcount.address] =
    totalEthStaked[userAcount.address].add(stakeAmount);
  const mined = await tx.wait();
  const txFee = mined.gasUsed.mul(mined.effectiveGasPrice);

  if (!userTxFees[userAcount.address]) {
    userTxFees[userAcount.address] = BigNumber.from(0);
  }
  userTxFees[userAcount.address] = userTxFees[userAcount.address].add(txFee);
};

export const requestWithdrawForUser = async (
  votiumStrategy: VotiumErc20Strategy,
  userAcount: SignerWithAddress,
  withdrawAmount: BigNumber
) => {
  const currentEpoch = await getCurrentEpoch();
  const requestTx = await votiumStrategy
    .connect(userAcount)
    .requestWithdraw(withdrawAmount);
  const minedRequestTx = await requestTx.wait();
  const event = minedRequestTx?.events?.find(
    (e) => e?.event === "WithdrawRequest"
  );
  const withdrawId = event?.args?.withdrawId;
  const unlockEpoch = (
    await votiumStrategy.withdrawIdToWithdrawRequestInfo(withdrawId)
  ).epoch;

  if (!unstakingTimes[userAcount.address])
    unstakingTimes[userAcount.address] = {};
  unstakingTimes[userAcount.address][withdrawId.toNumber()] = {
    epochRequested: currentEpoch,
    epochEligible: unlockEpoch.toNumber(),
    withdrawn: false,
    withdrawId,
  };
  return withdrawId;
};

export const withdrawForUser = async (
  votiumStrategy: VotiumErc20Strategy,
  userAcount: SignerWithAddress,
  withdrawId: number
) => {
  const ethBalanceBeforeWithdraw = await ethers.provider.getBalance(
    userAcount.address
  );

  const tx = await votiumStrategy.connect(userAcount).withdraw(withdrawId);
  const mined = await tx.wait();

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
  unstakingTimes[userAcount.address][withdrawId].withdrawn = true;
};

export const totalUserEthBalance = async () => {
  const userAccounts = await getUserAccounts();
  let totalBalance = BigNumber.from(0);
  for (let i = 0; i < userAccounts.length; i++) {
    const balance = await ethers.provider.getBalance(userAccounts[i].address);
    totalBalance = totalBalance.add(balance);
  }
  return totalBalance;
};
