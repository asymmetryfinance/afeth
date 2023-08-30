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

export type Epoch = number;
export type UnstakeRequestTime = {
  epochRequested: number;
  epochEligible: number;
  withdrawn: boolean;
  withdrawId: number;
};

export const totalEthStaked: Record<UserAddress, BigNumber> = {};
export const totalEthUnStaked: Record<UserAddress, BigNumber> = {};

type UnstakingTimes = Record<UserAddress, Record<Epoch, UnstakeRequestTime>>;
// request time / eligible for withdraw tiem for all users and withdraw requests
export const unstakingTimes: UnstakingTimes = {};

// all tx fees user spent staking & unstaking
export const userTxFees: Record<UserAddress, BigNumber> = {};
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
    console.log("applying rewards");
    // TODO this is probbly running out of rewards. make sure its all good and see if se need to fund it more
    const rewardEvent = await oracleApplyRewards(
      await getRewarderAccount(),
      votiumStrategy.address
    );
    console.log("applied rewards", rewardEvent);

    totalEthRewarded = totalEthRewarded.add(rewardEvent?.args?.ethAmount);

    console.log("rewardEvent", rewardEvent);
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

  if (!userTxFees[userAcount.address])
    userTxFees[userAcount.address] = BigNumber.from(0);
  userTxFees[userAcount.address].add(txFee);

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
  userTxFees[userAcount.address].add(txFee);
  const event = mined?.events?.find((e: any) => e?.event === "WithdrawRequest");

  console.log("event", event);

  const withdrawId = event?.args?.withdrawId;
  const unlockEpoch = await votiumStrategy.withdrawIdToEpoch(withdrawId);

  console.log("unlockEpoch", unlockEpoch);

  console.log("userAcount.address", userAcount.address);
  if (!unstakingTimes[userAcount.address])
    unstakingTimes[userAcount.address] = {};
  unstakingTimes[userAcount.address][unlockEpoch] = {
    epochRequested: currentEpoch,
    epochEligible: unlockEpoch,
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

    console.log("key is", key);
    console.log("looping", i, unstakingTimes[userAcount.address]);

    if (unstakingTimes[userAcount.address][key].withdrawn) continue;
    const unstakeRequestTime = unstakingTimes[userAcount.address][key];
    if (currentEpoch.lt(unstakeRequestTime.epochEligible)) continue;
    console.log("unstakeRequestTime", unstakeRequestTime);

    console.log(
      "about to do withdraw for ",
      userAcount.address,
      unstakeRequestTime.epochEligible,
      currentEpoch
    );
    console.log("about to call withdraw for key epoch", key);

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

    const balanceWithdrawn = ethBalanceAfterWithdraw.sub(
      ethBalanceBeforeWithdraw
    );
    if (!totalEthUnStaked[userAcount.address])
      totalEthUnStaked[userAcount.address] = BigNumber.from(0);
    totalEthUnStaked[userAcount.address] =
      totalEthUnStaked[userAcount.address].add(balanceWithdrawn);

    txFee = mined.gasUsed.mul(mined.effectiveGasPrice);
    userTxFees[userAcount.address].add(txFee);
    console.log(
      "setting withdrawn for userAcount.address",
      userAcount.address,
      key
    );
    unstakingTimes[userAcount.address][key].withdrawn = true;

    console.log("unstakingTimes is", JSON.stringify(unstakingTimes));
  }
};
