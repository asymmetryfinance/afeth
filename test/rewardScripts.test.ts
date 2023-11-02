import { expect } from "chai";
import { getProofsFromVotiumGithub } from "../scripts/generateClaimRewardsData";
import { ethers, network } from "hardhat";
import { wethAbi } from "./abis/wethAbi";
import { BigNumber } from "ethers";
import axios from "axios";
import { erc20Abi } from "./abis/erc20Abi";
import { oldVotiumAbi } from "./abis/oldVotiumAbi"; // TODO once we upgrade on mainnet we dont need this here
import { afEthAbi } from "./abis/afEthAbi";
import { AfEth } from "../typechain-types";

describe.only("Test Reward Scripts", async function () {
  it("Test the scripts", async function () {
    const accounts = await ethers.getSigners();
    const rewarderAddress = await new ethers.Contract(
      "0xb5D336912EB99d0eA05F499172F39768afab8D4b",
      oldVotiumAbi,
      accounts[0]
    ).rewarder();
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [rewarderAddress],
    });
    const impersonatedRewarderSigner = await ethers.getSigner(rewarderAddress);

    // send impersonated owner some eth
    let tx = await accounts[0].sendTransaction({
      to: rewarderAddress,
      value: "2000000000000000000", // 2 eth
    });
    await tx.wait();

    const votiumStrategy = new ethers.Contract(
      "0xb5D336912EB99d0eA05F499172F39768afab8D4b",
      oldVotiumAbi,
      impersonatedRewarderSigner
    );

    const afEth = new ethers.Contract(
      "0x5F10B16F0959AaC2E33bEdc9b0A4229Bb9a83590",
      afEthAbi,
      accounts[0]
    ) as AfEth;

    const proofs = await getProofsFromVotiumGithub();
    console.log("proofs", proofs);

    const claimTx = await votiumStrategy.claimRewards(proofs);
    await claimTx.wait();

    const cvx = await ethers.getContractAt(
      erc20Abi,
      "0x4e3fbd56cd56c3e72c1403e103b45db9da5b9d2b",
      accounts[0]
    );
    const cvxBalance = await cvx.balanceOf(votiumStrategy.address);

    console.log("cvx balance", cvxBalance.toString());
    //    process.exit(0);

    console.log("rewards claimed, now generating swap data");

    // now sell the rewards and apply them

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

      const sellAmount = BigNumber.from(tokenAmount);

      // special case unwrap weth
      if (
        sellToken.toLowerCase() ===
        "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2".toLowerCase()
      ) {
        const data = await tokenContract.populateTransaction.withdraw(
          sellAmount
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
        try {
          console.log(
            "sell amount",
            sellAmount.toString(),
            i,
            sellToken,
            buyToken
          );

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
          console.log(
            "0x doesnt support",
            i,
            sellToken,
            buyToken,
            sellAmount,
            e
          );
        }
      }
    }

    console.log("swaps data", swapsData);

    const priceBefore = await afEth.price(true);
    console.log("priceBefore", priceBefore.toString());

    tx = await votiumStrategy.applyRewards(swapsData, 0, 0);
    await tx.wait();

    const priceAfter = await afEth.price(true);
    console.log("priceAfter", priceAfter.toString());

    expect(true).eq(true);
  });
});
