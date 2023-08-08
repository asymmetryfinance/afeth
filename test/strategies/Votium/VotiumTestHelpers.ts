import axios from "axios";
import { parseBalanceMap } from "../../merkle_helpers/parse-balance-map";
import { ethers, network } from "hardhat";
import ERC20 from "@openzeppelin/contracts/build/contracts/ERC20.json";
import { wethAbi } from "../../abis/wethAbi";
import { vlCvxAbi } from "../../abis/vlCvxAbi";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { votiumStashControllerAbi } from "../../abis/votiumStashControllerAbi";
import { BigNumber } from "ethers";

export const epochDuration = 60 * 60 * 24 * 7;

export const updateRewardsMerkleRoot = async (
  votiumStrategyAddress: string
) => {
  const votiumStashControllerAddress =
    "0x9d37A22cEc2f6b3635c61C253D192E68e85b1790";
  const votiumStashControllerOwner =
    "0xe39b8617D571CEe5e75e1EC6B2bb40DdC8CF6Fa3";
  await network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [votiumStashControllerOwner],
  });
  const impersonatedOwnerSigner = await ethers.getSigner(
    votiumStashControllerOwner
  );
  const votiumStashController = new ethers.Contract(
    votiumStashControllerAddress,
    votiumStashControllerAbi,
    impersonatedOwnerSigner
  ) as any;

  // give owner some eth to do txs with
  const accounts = await ethers.getSigners();
  const tx = await accounts[0].sendTransaction({
    to: votiumStashControllerOwner,
    value: "2000000000000000000", // 2 eth
  });
  await tx.wait();

  // generate a merkle tree of rewards with our contract address and some other random addresses to make it realistic
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

  // set root from new mocked merkle data
  for (let i = 0; i < tokenAddresses.length; i++) {
    const merkleRoot = proofData[tokenAddresses[i]].merkleRoot;
    await votiumStashController.multiFreeze([tokenAddresses[i]]);
    await votiumStashController.multiSet([tokenAddresses[i]], [merkleRoot]);
  }

  const claimProofs = tokenAddresses.map((_: any, i: number) => {
    const pd = proofData[tokenAddresses[i]];
    return [
      tokenAddresses[i],
      pd.claims[votiumStrategyAddress].index,
      pd.claims[votiumStrategyAddress].amount,
      pd.claims[votiumStrategyAddress].proof,
    ];
  });

  return claimProofs;
};

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
      recipientAmounts[recipients[j]] = balances[i].div(recipients.length * 10); // this means after 10 claims it will be out of tokens
    proofData[tokenAddresses[i]] = await parseBalanceMap(recipientAmounts);
  }
  return proofData;
};

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

    // special case unwrap weth
    if (
      sellToken.toLowerCase() ===
      "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2".toLowerCase()
    ) {
      const data = await tokenContract.populateTransaction.withdraw(
        tokenAmounts[i]
      );
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
          `https://api.0x.org/swap/v1/quote?buyToken=${buyToken}&sellToken=${sellToken}&sellAmount=${BigNumber.from(
            tokenAmounts[i]
          )}`,
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
        console.log(
          "0x doesnt support",
          i,
          sellToken,
          buyToken,
          tokenAmounts[i],
          e
        );
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
