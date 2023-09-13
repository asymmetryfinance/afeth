import { ethers } from "hardhat";
import { VotiumErc20Strategy } from "../typechain-types";
import axios from "axios";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { wethAbi } from "../test/abis/wethAbi";
import { BigNumber } from "ethers";
import ERC20 from "@openzeppelin/contracts/build/contracts/ERC20.json";
import { parseBalanceMap } from "../test/helpers/parse-balance-map";

export const generate0xSwapData = async (
  tokenAddresses: string[],
  tokenAmounts: string[]
) => {
  const accounts = await ethers.getSigners();

  const swapsData = [];
  // swap reward tokens for eth
  for (let i = 0; i < tokenAddresses.length; i++) {
    console.log("generating swapdata for", i, tokenAddresses[i]);
    const sellToken = tokenAddresses[i];
    const buyToken = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

    // we use weth abi because we sometimes need to call withdraw on weth but its otherwise an erc20 abi
    const tokenContract = new ethers.Contract(
      tokenAddresses[i],
      wethAbi,
      accounts[0]
    );

    const sellAmount = BigNumber.from(tokenAmounts[i]);

    // special case unwrap weth
    if (
      sellToken.toLowerCase() ===
      "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2".toLowerCase()
    ) {
      const data = await tokenContract.populateTransaction.withdraw(sellAmount);
      const newData = {
        sellToken,
        spender: tokenContract.address,
        swapTarget: tokenContract.address,
        swapCallData: data.data,
      };
      swapsData.push(newData);
    } else {
      let result;
      // TODO do we want slippage protection or does it not matter and we just dump all the tokens anyway?
      try {
        result = await axios.get(
          `https://api.0x.org/swap/v1/quote?buyToken=${buyToken}&sellToken=${sellToken}&sellAmount=${sellAmount}&slippagePercentage=0.50`,
          {
            headers: {
              "0x-api-key":
                process.env.API_KEY_0X ||
                "35aa607c-1e98-4404-ad87-4bed10a538ae",
            },
          }
        );

        const newData = {
          sellToken,
          spender: result.data.allowanceTarget,
          swapTarget: result.data.to,
          swapCallData: result.data.data,
        };
        swapsData.push(newData);
      } catch (e) {
        console.log("0x doesnt support", i, sellToken, buyToken, sellAmount, e);
      }
    }
    // prevent 429s
    await new Promise((resolve) => setTimeout(resolve, 1100));
  }
  return swapsData;
};

// Claims all rewards using public votium merkle proofs
// or pass in proofs to override
export async function votiumClaimRewards(
  account: SignerWithAddress,
  strategyAddress: string,
  proofsOverride?: any
): Promise<any> {
  const VotiumInterface = (
    await ethers.getContractFactory("VotiumErc20Strategy")
  ).interface as any;
  const votiumStrategy = new ethers.Contract(
    strategyAddress,
    VotiumInterface,
    account
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
  account: SignerWithAddress,
  strategyAddress: string,
  proofs: any,
  swapsDataOverride?: any
) {
  const VotiumInterface = (
    await ethers.getContractFactory("VotiumErc20Strategy")
  ).interface as any;
  const votiumStrategy = new ethers.Contract(
    strategyAddress,
    VotiumInterface,
    account
  ) as VotiumErc20Strategy;
  if (swapsDataOverride) {
    const tx = await votiumStrategy.applyRewards(swapsDataOverride);
    const mined1 = await tx.wait();
    return mined1?.events?.find((e) => e?.event === "DepositReward");
  }

  const tokenAddresses = proofs.map((p: any) => p[0]);
  const tokenAmounts = proofs.map((p: any[]) => p[2]);
  const swapsData = await generate0xSwapData(tokenAddresses, tokenAmounts);
  const tx = await votiumStrategy.applyRewards(swapsData);
  const mined2 = await tx.wait();
  return mined2?.events?.find((e) => e?.event === "DepositReward");
}

const generateMockMerkleData = async (
  recipients: string[],
  divisibility: BigNumber,
  slice?: number
) => {
  const votiumRewardsContractAddress =
    "0x378Ba9B73309bE80BF4C2c027aAD799766a7ED5A";
  const { data } = await axios.get(
    "https://raw.githubusercontent.com/oo-00/Votium/main/merkle/activeTokens.json"
  );

  let tokenAddresses = data
    .map((d: any) => d.value)
    .filter(
      (d: any) =>
        d.toLowerCase() !==
          "0x2EBfF165CB363002C5f9cBcfd6803957BA0B7208".toLowerCase() && // geist token
        d.toLowerCase() !==
          "0xA0d69E286B938e21CBf7E51D71F6A4c8918f482F".toLowerCase() && // electronic dollar token
        d.toLowerCase() !==
          "0x402f878bdd1f5c66fdaf0fababcf74741b68ac36".toLowerCase() && // stake dao fxs
        d.toLowerCase() !==
          "0xa2E3356610840701BDf5611a53974510Ae27E2e1".toLowerCase() // Wrapped Binance Beacon ETH
    );
  if (slice) tokenAddresses = tokenAddresses.slice(0, slice);
  const accounts = await ethers.getSigners();

  const balances: any[] = [];
  for (let i = 0; i < tokenAddresses.length; i++) {
    const contract = new ethers.Contract(
      tokenAddresses[i],
      ERC20.abi,
      accounts[0]
    );
    const balanceBeforeClaim = await contract.balanceOf(
      votiumRewardsContractAddress
    );
    balances.push(balanceBeforeClaim);
  }
  const proofData = {} as any;
  for (let i = 0; i < tokenAddresses.length; i++) {
    const recipientAmounts = {} as any;
    for (let j = 0; j < recipients.length; j++) {
      if (balances[i].eq(0)) continue;
      recipientAmounts[recipients[j]] = balances[i]
        .div(recipients.length)
        .div(divisibility);
    }
    if (Object.keys(recipientAmounts).length === 0) continue;
    proofData[tokenAddresses[i]] = await parseBalanceMap(recipientAmounts);
  }

  return proofData;
};

export async function generateMockProofsAndSwaps(
  recipients: string[],
  strategyAddress: string,
  divisibility: BigNumber,
  slice?: number
) {
  const proofData = await generateMockMerkleData(
    recipients,
    divisibility,
    slice
  );
  const tokenAddresses = Object.keys(proofData);

  const claimProofs = tokenAddresses.map((_: any, i: number) => {
    const pd = proofData[tokenAddresses[i]];
    return [
      tokenAddresses[i],
      pd.claims[strategyAddress].index,
      pd.claims[strategyAddress].amount,
      pd.claims[strategyAddress].proof,
    ];
  });

  const merkleRoots = tokenAddresses.map(
    (ta: string) => proofData[ta].merkleRoot
  );

  const tokenAmounts = claimProofs.map((cp: any[]) => cp[2]);
  const swapsData = await generate0xSwapData(tokenAddresses, tokenAmounts);

  return { claimProofs, swapsData, merkleRoots };
}
