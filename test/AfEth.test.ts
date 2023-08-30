import { AfEth, SafEthStrategy, VotiumErc20Strategy } from "../typechain-types";
import { ethers, network, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { RETH_DERIVATIVE } from "./constants";
import { expect } from "chai";

describe.only("Test AfEth", async function () {
  let afEth: AfEth;
  let safEthStrategy: SafEthStrategy;
  let votiumStrategy: VotiumErc20Strategy;
  let accounts: SignerWithAddress[];

  const resetToBlock = async (blockNumber: number) => {
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.MAINNET_URL,
            blockNumber,
          },
        },
      ],
    });
    accounts = await ethers.getSigners();
    const afEthFactory = await ethers.getContractFactory("AfEth");
    afEth = (await upgrades.deployProxy(afEthFactory, [])) as AfEth;
    await afEth.deployed();

    const safEthFactory = await ethers.getContractFactory("SafEthStrategy");
    safEthStrategy = (await upgrades.deployProxy(safEthFactory, [
      afEth.address,
    ])) as SafEthStrategy;
    await safEthStrategy.deployed();

    const votiumFactory = await ethers.getContractFactory(
      "VotiumErc20Strategy"
    );
    votiumStrategy = (await upgrades.deployProxy(votiumFactory, [
      accounts[0].address,
      accounts[0].address,
      afEth.address,
    ])) as VotiumErc20Strategy;
    await votiumStrategy.deployed();

    await afEth.addStrategy(
      safEthStrategy.address,
      ethers.utils.parseEther(".5")
    );
    await afEth.addStrategy(
      votiumStrategy.address,
      ethers.utils.parseEther(".5")
    );

    // mint some to seed the system so totalSupply is never 0 (prevent price weirdness on withdraw)
    const tx = await afEth.connect(accounts[11]).deposit({
      value: ethers.utils.parseEther(".1"),
    });
    await tx.wait();
  };

  beforeEach(
    async () => await resetToBlock(parseInt(process.env.BLOCK_NUMBER ?? "0"))
  );
  it("Should mint, requestwithdraw, withdraw the safEth portion now, wait until votium can be withdrawn and withdraw again", async function () {
    const depositAmount = ethers.utils.parseEther("1");
    const mintTx = await afEth.deposit({ value: depositAmount });
    await mintTx.wait();
  });
  it("Two users should be able to deposit, requestWithdraw, withdraw full positions when votium can be withdrawn", async function () {
    // TODO
  });
  it("Two users should be able to deposit and requestWithdraw.  After one user withdraws safEth portion now, while other user waits to withdraw full positions when votium can be withdrawn", async function () {
    // TODO
  });
  it("Should be able to set Votium strategy to 0 ratio and still withdraw value from there while not being able to deposit", async function () {
    // TODO
  });
  it("Should be able to set SafEth strategy to 0 ratio and still withdraw value from there while not being able to deposit", async function () {
    // TODO
  });
  it("Should fail to set invalid strategy contracts", async function () {
    // try to add invalid address to strategies
    await expect(
      afEth.addStrategy(RETH_DERIVATIVE, ethers.utils.parseEther(".5"))
    ).to.be.revertedWith("InvalidStrategy()");
  });
});
