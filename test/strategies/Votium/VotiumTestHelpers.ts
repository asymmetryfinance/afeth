import axios from "axios";
import { parseBalanceMap } from "../../merkle_helpers/parse-balance-map";
import { ethers } from "hardhat";
import ERC20 from "@openzeppelin/contracts/build/contracts/ERC20.json";
import { wethAbi } from "../../abis/wethAbi";
import { vlCvxAbi } from "../../abis/vlCvxAbi";
import { time } from "@nomicfoundation/hardhat-network-helpers";

export const epochDuration = 60 * 60 * 24 * 7;

export const generateMockMerkleData = async (recipients: string[]) => {
  const votiumRewardsContractAddress =
    "0x378Ba9B73309bE80BF4C2c027aAD799766a7ED5A";
  const { data } = await axios.get(
    "https://raw.githubusercontent.com/oo-00/Votium/main/merkle/activeTokens.json"
  );

  // we only generate mock data for the first 5 tokens to show because the tests are very slow
  const tokenAddresses = data.map((d: any) => d.value).slice(0, 5);
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
    for (let j = 0; j < recipients.length; j++)
      recipientAmounts[recipients[j]] = balances[i].div(recipients.length);
    proofData[tokenAddresses[i]] = await parseBalanceMap(recipientAmounts);
  }
  return proofData;
};

export const generate0xSwapData = async (
  tokenAddresses: string[],
  votiumStrategyAddress: string
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

    const sellAmount = await tokenContract.balanceOf(votiumStrategyAddress);

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

// incremement time by 1 epoch and call await vlCvxContract.checkpointEpoch() so vlcv keeps working as time passes
// TODO make sure we are calling checkpoint epoch correctly and dont need to call any other functions
export const incrementVlcvxEpoch = async () => {
  const block = await ethers.provider.getBlock("latest");
  const blockTime = block.timestamp;
  const accounts = await ethers.getSigners();
  const vlCvxContract = new ethers.Contract(
    "0x72a19342e8F1838460eBFCCEf09F6585e32db86E",
    vlCvxAbi,
    accounts[0]
  );
  await time.increaseTo(blockTime + epochDuration);
  const tx = await vlCvxContract.checkpointEpoch();
  await tx.wait();
};