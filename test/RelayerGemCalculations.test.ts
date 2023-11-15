import { ethers, network, upgrades } from "hardhat";
import { stEthAbi } from "./abis/stEthAbi";
import { AfEth, AfEthRelayer } from "../typechain-types";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber, Contract } from "ethers";
import { afEthAbi } from "./abis/afEthAbi";
import { expect } from "chai";
import { safEthAbi } from "./abis/safEthAbi";
import { wstEthAbi } from "./abis/wstEthAbi";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const OETH_ADDRESS = "0x856c4Efb76C1D1AE02e20CEB03A2A6a08b0b8dC3";
const AFETH_ADDRESS = "0x5F10B16F0959AaC2E33bEdc9b0A4229Bb9a83590";
const STETH_ADDRESS = "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84";
const SAFETH_ADDRESS = "0x6732Efaf6f39926346BeF8b821a04B6361C4F3e5";
const WSTETH_ADDRESS = "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0";

const oethWhale = "0x8e02247d3ee0e6153495c971ffd45aa131f4d7cb";
const lidoWhale = "0x02ed4a07431bcc26c5519ebf8473ee221f26da8b";
const wstWhale = "0x176f3dab24a159341c0509bb36b833e7fdd0a132";

const nowPlusOneMinute = async () =>
  (await ethers.provider.getBlock("latest")).timestamp + 60;

describe.only("Tests showing calculations for the different ways of accumulating gems from contract events", async function () {
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
    const afEthFactory = await ethers.getContractFactory("AfEthRelayer");
    afEthRelayer = (await upgrades.deployProxy(
      afEthFactory,
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

  it("Should detect relayer events for safEth and afEth deposits", async function () {
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

    const signer = await ethers.getSigner(oethWhale);

    await OETH.connect(signer).approve(
      afEthRelayer.address,
      ethers.constants.MaxUint256
    );

    const tx = await afEthRelayer
      .connect(signer)
      .depositSafEth(
        0,
        oethWhale,
        OETH_ADDRESS,
        sellAmount,
        quote.allowanceTarget,
        quote.to,
        quote.data
      );
    await tx.wait();

    const tx2 = await afEthRelayer
      .connect(signer)
      .depositAfEth(
        0,
        await nowPlusOneMinute(),
        oethWhale,
        OETH_ADDRESS,
        sellAmount,
        quote.allowanceTarget,
        quote.to,
        quote.data
      );
    await tx2.wait();
    const events = await getPastEvents(
      afEthRelayer.address,
      oethWhale,
      OETH_ADDRESS
    );

    console.log("got oeth deposit events for safEth and afEth", events);
  });
});

async function getPastEvents(
  contractAddress: string,
  recipient: string,
  sellToken: string
) {
  const contractABI = [
    "event DepositSafEth(address indexed sellToken, uint256 sellAmount, uint256 safEthAmount, address indexed recipient)",
    "event DepositAfEth(address indexed sellToken, uint256 sellAmount, uint256 afEthAmount, address indexed recipient)",
  ];
  const contract = new ethers.Contract(
    contractAddress,
    contractABI,
    ethers.provider
  );

  const depositSafEthFilter = contract.filters.DepositSafEth(
    sellToken,
    null,
    null,
    recipient
  );

  const depositSafEthEvents = await contract.queryFilter(
    depositSafEthFilter,
    0,
    "latest"
  );

  const depositAfEthFilter = contract.filters.DepositSafEth(
    sellToken,
    null,
    null,
    recipient
  );

  const depositAfEthEvents = await contract.queryFilter(
    depositAfEthFilter,
    0,
    "latest"
  );

  return {
    depositSafEthEvents,
    depositAfEthEvents,
  };
}
