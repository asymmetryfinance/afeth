import clone from "git-clone/promise.js";
import Fs from "@supercharge/fs";
import BigNumber from "bignumber.js";
import yesno from "yesno";
import { ethers, network } from "hardhat";
import { votiumMultiMerkleStashAbi } from "../test/abis/votiumMerkleStashAbi";
import axios from "axios";
import { wethAbi } from "../test/abis/wethAbi";

(async function main() {
  await network.provider.request({
    method: "hardhat_reset",
    params: [
      {
        forking: {
          jsonRpcUrl: process.env.MAINNET_URL,
        },
      },
    ],
  });

  console.log("Cloning votium merkle data repo...");
  await clone("https://github.com/oo-00/Votium.git", "./votium");
  const proofs = await getProofsFromVotiumGithub();
  const swapData = await get0xSwapData(proofs);
  console.log("merkleProofs:");
  console.log(JSON.stringify(proofs));
  console.log("swapData:");
  console.log(JSON.stringify(swapData));
})()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

export async function get0xSwapData(proofs: any) {
  const accounts = await ethers.getSigners();
  const swapsData = [];
  // swap reward tokens for eth
  for (let i = 0; i < proofs.length; i++) {
    // prevent 429s
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const tokenAddress = proofs[i][0];
    const tokenAmount = proofs[i][2];
    console.log("generating swapdata for", i, tokenAddress);
    const sellToken = tokenAddress;
    const buyToken = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

    // we use weth abi because we sometimes need to call withdraw on weth but its otherwise an erc20 abi
    const tokenContract = new ethers.Contract(
      tokenAddress,
      wethAbi,
      accounts[0]
    );

    const sellAmount = new BigNumber(tokenAmount).toString();

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
      try {
        result = await axios.get(
          `https://api.0x.org/swap/v1/quote?buyToken=${buyToken}&sellToken=${sellToken}&sellAmount=${sellAmount}&slippagePercentage=0.90`,
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
        console.log("**********WARNING**********");
        console.log("0x doesnt support", i, sellToken, buyToken, sellAmount, e);
      }
    }
  }
  return swapsData;
}

export async function getProofsFromVotiumGithub() {
  const files = await Fs.files("./votium/merkle"); // use allFiles to recursively search
  const proofs: any = [];
  const addresses = await Fs.content("./votium/merkle/activeTokens.json");
  const address = "0xb5D336912EB99d0eA05F499172F39768afab8D4b";

  const accounts = await ethers.getSigners();
  const votiumMerkleStash = new ethers.Contract(
    "0x378Ba9B73309bE80BF4C2c027aAD799766a7ED5A",
    votiumMultiMerkleStashAbi,
    accounts[0]
  );

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (file.includes(".")) {
      return proofs;
    }
    const fileContentString = Fs.readFileSync(
      "./votium/merkle/" + file + "/" + file + ".json"
    ).toString();
    if (fileContentString.includes(address)) {
      const json = JSON.parse(fileContentString);
      const data = json?.claims?.[address];
      if (!data) return;
      const symbol = file;
      const tokenAddress = JSON.parse(addresses).find(
        (a: any) => a.symbol === symbol
      );
      if (!tokenAddress) throw new Error(`No address found for ${symbol}`);
      else {
        const isAlreadyClaimed = await votiumMerkleStash.isClaimed(
          tokenAddress.value,
          data.index
        );

        if (isAlreadyClaimed) continue;

        const normalizedClaimableAmount = new BigNumber(data.amount)
          .dividedBy(new BigNumber(10).pow(tokenAddress.decimals))
          .toString();

        const include = await yesno({
          question: `${tokenAddress.value} ${tokenAddress.symbol} ${normalizedClaimableAmount}  (include? y/n)`,
        });
        if (include) {
          const proofData = [
            tokenAddress.value,
            data.index,
            data.amount,
            data.proof,
          ];
          proofs.push(proofData);
        }
      }
    }
  }

  return proofs;
}
