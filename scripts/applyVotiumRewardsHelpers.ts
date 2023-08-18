import { ethers } from "hardhat";
import { VotiumErc20Strategy } from "../typechain-types";
import axios from "axios";
import { generate0xSwapData } from "./generateTestData";

// Claims all rewards using public votium merkle proofs
// or pass in proofs to override
export async function votiumClaimRewards(strategyAddress: string, proofsOverride?: any): Promise<any> {
  const accounts = await ethers.getSigners();
  const VotiumInterface = (
    await ethers.getContractFactory("VotiumErc20Strategy")
  ).interface as any;
  const votiumStrategy = new ethers.Contract(
    strategyAddress,
    VotiumInterface,
    accounts[0]
  ) as VotiumErc20Strategy;

  let proofs: any;
  if (!proofsOverride) {
    const { data } = await axios.get(
      "https://merkle-api-production.up.railway.app/proof/0xbbba116ef0525cd5ea9f4a9c1f628c3bfc343261"
    );
    proofs = data.proofs;
  } else proofs = proofsOverride;
  const tx = await votiumStrategy.claimRewards(proofs);
  await tx.wait();
  return proofs;
}

// Sell rewards that were claimed by the given proofs
// or override with swapsDataOverride
export async function votiumSellRewards(
  strategyAddress: string,
  proofs: any,
  swapsDataOverride?: any
) {
  const accounts = await ethers.getSigners();
  const VotiumInterface = (
    await ethers.getContractFactory("VotiumErc20Strategy")
  ).interface as any;
  const votiumStrategy = new ethers.Contract(
    strategyAddress,
    VotiumInterface,
    accounts[0]
  ) as VotiumErc20Strategy;
  if (swapsDataOverride) {
    const tx = await votiumStrategy.applyRewards(swapsDataOverride);
    await tx.wait();
    return;
  }

  const tokenAddresses = proofs.map((p: any) => p[0]);
  const tokenAmounts = proofs.map((p: any[]) => p[2]);
  const swapsData = await generate0xSwapData(tokenAddresses, tokenAmounts);
  const tx = await votiumStrategy.applyRewards(swapsData);
   await tx.wait();
}
