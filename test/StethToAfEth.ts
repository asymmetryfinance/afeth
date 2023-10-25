import { ethers, network, upgrades } from "hardhat";
import { stEthAbi } from "./abis/stEthAbi";
import { relayerAbi } from "./abis/relayerAbi";
import { AfEthRelayer } from "../typechain-types";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

describe("Test stETH to AF", async function () {
  const STETH_ADDRESS = "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84";
  const ETH_ADDRESS = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  let accounts: SignerWithAddress[];
  let afEthRelayer: AfEthRelayer;

  beforeEach(async () => {
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.MAINNET_URL,
            blockNumber: 18429562,
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
    const sellAmount = ethers.utils.parseEther(".001");
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
    console.log("quote:", quote);

    const tx = await afEthRelayer.depositSafEth(
      0,
      accounts[0].address,
      STETH_ADDRESS,
      quote.allowanceTarget,
      quote.to,
      quote.data,
      { value: sellAmount }
    );
  });
});
