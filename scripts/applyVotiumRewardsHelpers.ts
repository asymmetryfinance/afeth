import { ethers } from "hardhat";
import { VotiumErc20Strategy } from "../typechain-types";
import axios from "axios";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { wethAbi } from "../test/abis/wethAbi";
import { BigNumber } from "ethers";

export const generate0xSwapData = async (
  tokenAddresses: string[],
  tokenAmounts: string[]
) => {
  const accounts = await ethers.getSigners();

  const swapsData = [];
  // swap reward tokens for eth
  for (let i = 0; i < tokenAddresses.length; i++) {
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
          `https://api.0x.org/swap/v1/quote?buyToken=${buyToken}&sellToken=${sellToken}&sellAmount=${sellAmount}`,
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
    await new Promise((resolve) => setTimeout(resolve, 500));
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
    await tx.wait();
    return;
  }

  const tokenAddresses = proofs.map((p: any) => p[0]);
  const tokenAmounts = proofs.map((p: any[]) => p[2]);
  const swapsData = await generate0xSwapData(tokenAddresses, tokenAmounts);
  const tx = await votiumStrategy.applyRewards(swapsData);
  await tx.wait();
}
