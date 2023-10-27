import { ethers, network, upgrades } from "hardhat";
import { stEthAbi } from "./abis/stEthAbi";
import { AfEthRelayer } from "../typechain-types";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber } from "ethers";

describe("Test stETH to AF", async function () {
  const STETH_ADDRESS = "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84";

  let accounts: SignerWithAddress[];
  let afEthRelayer: AfEthRelayer;

  beforeEach(async () => {
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.MAINNET_URL,
            blockNumber: 18443505,
          },
        },
      ],
    });
    accounts = await ethers.getSigners();
    const afEthFactory = await ethers.getContractFactory("AfEthRelayer");
    afEthRelayer = (await upgrades.deployProxy(
      afEthFactory,
      []
    )) as AfEthRelayer;
    await afEthRelayer.deployed();
  });

  it("Should approve & swap stEth to Eth, then deposit into SafEth", async function () {
    const takerAddress = "0x02eD4a07431Bcc26c5519EbF8473Ee221F26Da8b"; // Lido Whale
    const sellAmount = ethers.utils.parseEther("30");
    const STETH = new ethers.Contract(STETH_ADDRESS, stEthAbi, ethers.provider);

    const quote = await fetch(
      `https://api.0x.org/swap/v1/quote?sellToken=${STETH_ADDRESS}&buyToken=WETH&sellAmount=${sellAmount}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "0x-api-key": process.env.API_KEY_0X,
        } as any,
      }
    ).then(async (response) => {
      return response.json();
    });

    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [takerAddress],
    });

    // Get a signer for the account we are impersonating
    const signer = await ethers.getSigner(takerAddress);

    await STETH.connect(signer).approve(
      afEthRelayer.address,
      ethers.constants.MaxUint256
    );

    const tx = await afEthRelayer
      .connect(signer)
      .depositSafEth(
        0,
        accounts[0].address,
        STETH_ADDRESS,
        sellAmount,
        quote.allowanceTarget,
        quote.to,
        quote.data
      );
    const receipt = await tx.wait();
    const gasUsed = BigNumber.from(receipt.cumulativeGasUsed).mul(
      receipt.effectiveGasPrice
    );
    console.log({ gasUsed, gasPrice: receipt.effectiveGasPrice });
  });
  it("Should approve & swap stEth to Eth, then deposit into AfEth", async function () {
    const takerAddress = "0x02eD4a07431Bcc26c5519EbF8473Ee221F26Da8b"; // Lido Whale
    const sellAmount = ethers.utils.parseEther("30");
    const STETH = new ethers.Contract(STETH_ADDRESS, stEthAbi, ethers.provider);

    const quote = await fetch(
      `https://api.0x.org/swap/v1/quote?sellToken=${STETH_ADDRESS}&buyToken=WETH&sellAmount=${sellAmount}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "0x-api-key": process.env.API_KEY_0X,
        } as any,
      }
    ).then(async (response) => {
      return response.json();
    });

    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [takerAddress],
    });

    // Get a signer for the account we are impersonating
    const signer = await ethers.getSigner(takerAddress);

    await STETH.connect(signer).approve(
      afEthRelayer.address,
      ethers.constants.MaxUint256
    );

    const tx = await afEthRelayer
      .connect(signer)
      .depositAfEth(
        0,
        (await ethers.provider.getBlock("latest")).timestamp + 60,
        accounts[0].address,
        STETH_ADDRESS,
        sellAmount,
        quote.allowanceTarget,
        quote.to,
        quote.data
      );
    const receipt = await tx.wait();
    const gasUsed = BigNumber.from(receipt.cumulativeGasUsed).mul(
      receipt.effectiveGasPrice
    );
    console.log({ gasUsed, gasPrice: receipt.effectiveGasPrice });
  });
});
