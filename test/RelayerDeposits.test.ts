import { ethers, network, upgrades } from "hardhat";
import { stEthAbi } from "./abis/stEthAbi";
import { AfEth, AfEthRelayer } from "../typechain-types";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber, Contract } from "ethers";
import { afEthAbi } from "./abis/afEthAbi";
import { expect } from "chai";
import { safEthAbi } from "./abis/safEthAbi";
import { wstEthAbi } from "./abis/wstEthAbi";

// TODO: skipping due to needing to wait for the upgrade for afEthRelayer to be deployed
describe.skip("Test relayer deposit of oETH, lido & wstEth to afEth and safEth", async function () {
  const OETH_ADDRESS = "0x856c4Efb76C1D1AE02e20CEB03A2A6a08b0b8dC3";
  const AFETH_ADDRESS = "0x5F10B16F0959AaC2E33bEdc9b0A4229Bb9a83590";
  const STETH_ADDRESS = "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84";
  const SAFETH_ADDRESS = "0x6732Efaf6f39926346BeF8b821a04B6361C4F3e5";
  const WSTETH_ADDRESS = "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0";

  const oethWhale = "0x8e02247d3ee0e6153495c971ffd45aa131f4d7cb";
  const lidoWhale = "0x02ed4a07431bcc26c5519ebf8473ee221f26da8b";
  const wstWhale = "0x176f3dab24a159341c0509bb36b833e7fdd0a132";

  let accounts: SignerWithAddress[];

  let afEthRelayer: AfEthRelayer;
  let afEth: AfEth;
  let safEth: Contract;

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
    const afEthRelayerFactory = await ethers.getContractFactory("AfEthRelayer");
    afEthRelayer = (await upgrades.deployProxy(
      afEthRelayerFactory,
      []
    )) as AfEthRelayer;
    await afEthRelayer.deployed();

    afEth = new ethers.Contract(
      AFETH_ADDRESS,
      afEthAbi,
      ethers.provider
    ) as AfEth;
    safEth = new ethers.Contract(SAFETH_ADDRESS, safEthAbi, ethers.provider);
  });

  it("Should approve & swap oEth to Eth, then deposit into SafEth", async function () {
    const sellAmount = ethers.utils.parseEther("2");
    const OETH = new ethers.Contract(OETH_ADDRESS, stEthAbi, ethers.provider);

    const quote = await fetch(
      `https://api.0x.org/swap/v1/quote?sellToken=${OETH_ADDRESS}&buyToken=WETH&sellAmount=${sellAmount}`,
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
      params: [oethWhale],
    });

    // Get a signer for the account we are impersonating
    const signer = await ethers.getSigner(oethWhale);

    await OETH.connect(signer).approve(
      afEthRelayer.address,
      ethers.constants.MaxUint256
    );
    const safEthBalanceBefore = await afEth.balanceOf(accounts[0].address);
    const tx = await afEthRelayer
      .connect(signer)
      .depositSafEth(
        0,
        accounts[0].address,
        OETH_ADDRESS,
        sellAmount,
        quote.allowanceTarget,
        quote.to,
        quote.data
      );
    const safEthBalanceAfter = await safEth.balanceOf(accounts[0].address);
    const receipt = await tx.wait();
    const safEthReceived = safEthBalanceAfter.sub(safEthBalanceBefore);
    expect(safEthReceived).gt(0);
    const gasUsed = BigNumber.from(receipt.gasUsed);

    console.log({ gasUsed, gasPrice: receipt.effectiveGasPrice });
  });
  it.only("Should approve & swap oEth to Eth, then deposit into AfEth", async function () {
    const sellAmount = ethers.utils.parseEther("2");
    const OETH = new ethers.Contract(OETH_ADDRESS, stEthAbi, ethers.provider);
    const takerAddress = "0x8e02247d3ee0e6153495c971ffd45aa131f4d7cb"; // Oeth Whale

    const quote = await fetch(
      `https://api.0x.org/swap/v1/quote?sellToken=${OETH_ADDRESS}&buyToken=WETH&sellAmount=${sellAmount}`,
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

    await OETH.connect(signer).approve(
      afEthRelayer.address,
      ethers.constants.MaxUint256
    );

    const afEthBalanceBefore = await afEth.balanceOf(accounts[0].address);
    const tx = await afEthRelayer
      .connect(signer)
      .depositAfEth(
        0,
        (await ethers.provider.getBlock("latest")).timestamp + 60,
        accounts[0].address,
        OETH_ADDRESS,
        sellAmount,
        quote.allowanceTarget,
        quote.to,
        quote.data
      );
    const receipt = await tx.wait();
    const gasUsed = BigNumber.from(receipt.gasUsed);
    console.log({ gasUsed, gasPrice: receipt.effectiveGasPrice });

    const afEthBalanceAfter = await afEth.balanceOf(accounts[0].address);
    const afEthReceived = afEthBalanceAfter.sub(afEthBalanceBefore);
    expect(afEthReceived).gt(0);

    console.log({ afEthReceived: afEthReceived.toString() });
  });

  it("Should approve & swap stEth to Eth, then deposit into SafEth", async function () {
    const sellAmount = ethers.utils.parseEther("2");
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
      params: [lidoWhale],
    });

    // Get a signer for the account we are impersonating
    const signer = await ethers.getSigner(lidoWhale);

    await STETH.connect(signer).approve(
      afEthRelayer.address,
      ethers.constants.MaxUint256
    );

    const safEthBalanceBefore = await safEth.balanceOf(accounts[0].address);
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
    const safEthBalanceAfter = await safEth.balanceOf(accounts[0].address);
    const safEthReceived = safEthBalanceAfter.sub(safEthBalanceBefore);

    expect(safEthReceived).gt(0);

    const gasUsed = BigNumber.from(receipt.gasUsed);

    console.log({ gasUsed, gasPrice: receipt.effectiveGasPrice });
  });
  it("Should approve & swap stEth to Eth, then deposit into AfEth", async function () {
    const sellAmount = ethers.utils.parseEther("2");
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
      params: [lidoWhale],
    });

    // Get a signer for the account we are impersonating
    const signer = await ethers.getSigner(lidoWhale);

    await STETH.connect(signer).approve(
      afEthRelayer.address,
      ethers.constants.MaxUint256
    );

    const afEthBalanceBefore = await afEth.balanceOf(accounts[0].address);
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
    const afEthBalanceAfter = await afEth.balanceOf(accounts[0].address);
    const afEthReceived = afEthBalanceAfter.sub(afEthBalanceBefore);
    expect(afEthReceived).gt(0);
    const gasUsed = BigNumber.from(receipt.gasUsed);
    console.log({ gasUsed, gasPrice: receipt.effectiveGasPrice });
  });

  it.only("Should approve & swap wstEth to Eth, then deposit into SafEth", async function () {
    const sellAmount = ethers.utils.parseEther("2");
    const WSTETH = new ethers.Contract(
      WSTETH_ADDRESS,
      wstEthAbi,
      ethers.provider
    );

    const quote = await fetch(
      `https://api.0x.org/swap/v1/quote?sellToken=${WSTETH_ADDRESS}&buyToken=WETH&sellAmount=${sellAmount}`,
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
      params: [wstWhale],
    });

    // Get a signer for the account we are impersonating
    const signer = await ethers.getSigner(wstWhale);

    await WSTETH.connect(signer).approve(
      afEthRelayer.address,
      ethers.constants.MaxUint256
    );

    const safEthBalanceBefore = await safEth.balanceOf(accounts[0].address);
    const tx = await afEthRelayer
      .connect(signer)
      .depositSafEth(
        0,
        accounts[0].address,
        WSTETH_ADDRESS,
        sellAmount,
        quote.allowanceTarget,
        quote.to,
        quote.data
      );

    const receipt = await tx.wait();
    const safEthBalanceAfter = await safEth.balanceOf(accounts[0].address);
    const safEthReceived = safEthBalanceAfter.sub(safEthBalanceBefore);

    expect(safEthReceived).gt(0);

    const gasUsed = BigNumber.from(receipt.gasUsed);

    console.log({ gasUsed, gasPrice: receipt.effectiveGasPrice });
  });
  it.only("Should approve & swap wstEth to Eth, then deposit into AfEth", async function () {
    const sellAmount = ethers.utils.parseEther("2");
    const WSTETH = new ethers.Contract(
      WSTETH_ADDRESS,
      wstEthAbi,
      ethers.provider
    );

    const quote = await fetch(
      `https://api.0x.org/swap/v1/quote?sellToken=${WSTETH_ADDRESS}&buyToken=WETH&sellAmount=${sellAmount}`,
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
      params: [wstWhale],
    });

    // Get a signer for the account we are impersonating
    const signer = await ethers.getSigner(wstWhale);

    await WSTETH.connect(signer).approve(
      afEthRelayer.address,
      ethers.constants.MaxUint256
    );

    const afEthBalanceBefore = await afEth.balanceOf(accounts[0].address);
    const tx = await afEthRelayer
      .connect(signer)
      .depositAfEth(
        0,
        (await ethers.provider.getBlock("latest")).timestamp + 60,
        accounts[0].address,
        WSTETH_ADDRESS,
        sellAmount,
        quote.allowanceTarget,
        quote.to,
        quote.data
      );
    const receipt = await tx.wait();
    const afEthBalanceAfter = await afEth.balanceOf(accounts[0].address);
    const afEthReceived = afEthBalanceAfter.sub(afEthBalanceBefore);
    expect(afEthReceived).gt(0);
    const gasUsed = BigNumber.from(receipt.gasUsed);
    console.log({ gasUsed, gasPrice: receipt.effectiveGasPrice });
  });

  it("Should test minout deposit safEth", async () => {
    const sellAmount = ethers.utils.parseEther("2");
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
      params: [lidoWhale],
    });

    // Get a signer for the account we are impersonating
    const signer = await ethers.getSigner(lidoWhale);

    await STETH.connect(signer).approve(
      afEthRelayer.address,
      ethers.constants.MaxUint256
    );
    try {
      await afEthRelayer
        .connect(signer)
        .depositSafEth(
          sellAmount.mul(2),
          accounts[0].address,
          STETH_ADDRESS,
          sellAmount,
          quote.allowanceTarget,
          quote.to,
          quote.data
        );
    } catch (e) {
      // I did it this hacky way because it wasnt passing through a good revert message for some reason
      return expect(true).eq(true);
    }
    expect(false).eq(true);
  });
});
