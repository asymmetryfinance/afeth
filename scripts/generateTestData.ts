import * as path from "path";
import * as fs from "fs";
import axios from "axios";
import { BigNumber } from "ethers";
import { wethAbi } from "../test/abis/wethAbi";
import { ethers } from "hardhat";
import { parseBalanceMap } from "../test/merkle_helpers/parse-balance-map";
import ERC20 from "@openzeppelin/contracts/build/contracts/ERC20.json";

function writeJSONToFile(obj: any, filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const jsonString = JSON.stringify(obj, null, 2); // Convert the object to a JSON string with 2-space indentation
    fs.writeFile(path.resolve(filePath), jsonString, "utf8", (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

const generateMockMerkleData = async (recipients: string[]) => {
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
      recipientAmounts[recipients[j]] = balances[i].div(recipients.length * 10); // this means after 10 claims it will be out of tokens
    proofData[tokenAddresses[i]] = await parseBalanceMap(recipientAmounts);
  }

  console.log("returning proof data generated", proofData);
  return proofData;
};

const generate0xSwapData = async (
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

    console.log(
      "trueBalance is",
      await tokenContract.balanceOf(
        "0x378Ba9B73309bE80BF4C2c027aAD799766a7ED5A"
      ),
      sellAmount.toString()
    );

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

        console.log("pushing swap data", newData);

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
async function main() {
  // address of VotiumStrategy contract that will be used in the tests
  const votiumStrategyAddress = "0x38628490c3043E5D0bbB26d5a0a62fC77342e9d5";

  const proofData = await generateMockMerkleData([
    votiumStrategyAddress,
    "0x8a65ac0E23F31979db06Ec62Af62b132a6dF4741",
    "0x0000462df2438f7b39577917374b1565c306b908",
    "0x000051d46ff97559ed5512ac9d2d95d0ef1140e1",
    "0xc90c5cc170a8db4c1b66939e1a0bb9ad47c93602",
    "0x47CB53752e5dc0A972440dA127DCA9FBA6C2Ab6F",
    "0xe7ebef64f1ff602a28d8d37049e46d0ca77a38ac",
    "0x76a1f47f8d998d07a15189a07d9aada180e09ac6",
  ]);
  const tokenAddresses = Object.keys(proofData);

  const claimProofs = tokenAddresses.map((_: any, i: number) => {
    const pd = proofData[tokenAddresses[i]];
    return [
      tokenAddresses[i],
      pd.claims[votiumStrategyAddress].index,
      pd.claims[votiumStrategyAddress].amount,
      pd.claims[votiumStrategyAddress].proof,
    ];
  });

  const merkleRoots = tokenAddresses.map(
    (ta: string) => proofData[ta].merkleRoot
  );

  const tokenAmounts = claimProofs.map((cp: any[]) => cp[2]);
  const swapsData = await generate0xSwapData(tokenAddresses, tokenAmounts);

  await writeJSONToFile(
    { claimProofs, swapsData, merkleRoots },
    path.resolve(__dirname, "testData.json")
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
