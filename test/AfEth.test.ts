import { AfEth, SafEthStrategy, VotiumErc20Strategy } from "../typechain-types";
import { ethers, network, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { MULTI_SIG, RETH_DERIVATIVE, WST_DERIVATIVE } from "./constants";
import { expect } from "chai";
import { incrementVlcvxEpoch } from "./strategies/VotiumErc20/VotiumTestHelpers";
import { derivativeAbi } from "./abis/derivativeAbi";
import { within1Percent } from "./helpers/helpers";

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

    // mock chainlink feeds so not out of date
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [MULTI_SIG],
    });

    const chainLinkRethFeedFactory = await ethers.getContractFactory(
      "ChainLinkRethFeedMock"
    );
    const chainLinkWstFeedFactory = await ethers.getContractFactory(
      "ChainLinkWstFeedMock"
    );

    const chainLinkRethFeed = await chainLinkRethFeedFactory.deploy();
    const chainLinkWstFeed = await chainLinkWstFeedFactory.deploy();

    const multiSigSigner = await ethers.getSigner(MULTI_SIG);

    // mock chainlink feed on derivatives
    const rEthDerivative = new ethers.Contract(
      RETH_DERIVATIVE,
      derivativeAbi,
      accounts[0]
    );
    const multiSigReth = rEthDerivative.connect(multiSigSigner);
    await multiSigReth.setChainlinkFeed(chainLinkRethFeed.address);

    const wstEthDerivative = new ethers.Contract(
      WST_DERIVATIVE,
      derivativeAbi,
      accounts[0]
    );

    const multiSigWst = wstEthDerivative.connect(multiSigSigner);
    await multiSigWst.setChainlinkFeed(chainLinkWstFeed.address);
    // mint some to seed the system so totalSupply is never 0 (prevent price weirdness on withdraw)
    const tx = await afEth.connect(accounts[11]).deposit({
      value: ethers.utils.parseEther(".1"),
    });
    await tx.wait();
  };

  beforeEach(
    async () => await resetToBlock(parseInt(process.env.BLOCK_NUMBER ?? "0"))
  );

  it("Should mint, requestwithdraw, and withdraw afETH", async function () {
    const depositAmount = ethers.utils.parseEther("1");
    const mintTx = await afEth.deposit({ value: depositAmount });
    await mintTx.wait();

    const mintedAfEthAmount = "1000075263435139093";

    const afEthBalanceBeforeRequest = await afEth.balanceOf(
      accounts[0].address
    );
    expect(afEthBalanceBeforeRequest).eq(mintedAfEthAmount);

    const requestWithdrawTx = await afEth.requestWithdraw();
    await requestWithdrawTx.wait();

    const afEthBalanceAfterRequest = await afEth.balanceOf(accounts[0].address);

    for (let i = 0; i < 17; i++) {
      await incrementVlcvxEpoch();
    }

    const withdrawId = await afEth.latestWithdrawId();
    const withdrawInfo = await afEth.withdrawIdInfo(withdrawId);
    expect(withdrawInfo.amount).eq(mintedAfEthAmount);
    expect(withdrawInfo.owner).eq(accounts[0].address);
    expect(afEthBalanceAfterRequest).eq(0);

    const ethBalanceBeforeWithdraw = await ethers.provider.getBalance(
      accounts[0].address
    );

    const withdrawTx = await afEth.withdraw(withdrawId);
    await withdrawTx.wait();

    const ethBalanceAfterWithdraw = await ethers.provider.getBalance(
      accounts[0].address
    );

    expect(ethBalanceAfterWithdraw).gt(ethBalanceBeforeWithdraw);
  });
  it("Should fail to withdraw if epoch for votium hasn't been reached", async function () {
    const depositAmount = ethers.utils.parseEther("1");
    const mintTx = await afEth.deposit({ value: depositAmount });
    await mintTx.wait();

    const requestWithdrawTx = await afEth.requestWithdraw();
    await requestWithdrawTx.wait();
    const withdrawId = await afEth.latestWithdrawId();

    await expect(afEth.withdraw(withdrawId)).to.be.revertedWith(
      "CanNotWithdraw()"
    );
  });
  it.only("Two users should be able to simultaneously deposit the same amount, requestWithdraw, withdraw and split rewards", async function () {
    const user1 = afEth.connect(accounts[1]);
    const user2 = afEth.connect(accounts[2]);

    const depositAmount = ethers.utils.parseEther("1");

    const mintTx1 = await user1.deposit({ value: depositAmount });
    await mintTx1.wait();
    const mintTx2 = await user2.deposit({ value: depositAmount });
    await mintTx2.wait();

    const afEthBalanceBeforeRequest1 = await user1.balanceOf(
      accounts[1].address
    );
    const afEthBalanceBeforeRequest2 = await user2.balanceOf(
      accounts[2].address
    );

    console.log({ afEthBalanceBeforeRequest1, afEthBalanceBeforeRequest2 });
    expect(
      within1Percent(afEthBalanceBeforeRequest1, afEthBalanceBeforeRequest2)
    );

    // deposit votium rewards
    const tx = await votiumStrategy.depositRewards(depositAmount, {
      value: depositAmount,
    });
    await tx.wait();

    const requestWithdrawTx1 = await user1.requestWithdraw();
    await requestWithdrawTx1.wait();
    const requestWithdrawTx2 = await user2.requestWithdraw();
    await requestWithdrawTx2.wait();

    for (let i = 0; i < 17; i++) {
      await incrementVlcvxEpoch();
    }

    const withdrawInfo1 = await afEth.withdrawIdInfo(1);
    const withdrawInfo2 = await afEth.withdrawIdInfo(2);

    console.log({
      withdrawInfo1,
      withdrawInfo2,
      address1: accounts[1].address,
      address2: accounts[2].address,
    });

    const ethBalanceBeforeWithdraw1 = await ethers.provider.getBalance(
      accounts[1].address
    );
    const ethBalanceBeforeWithdraw2 = await ethers.provider.getBalance(
      accounts[2].address
    );

    const withdrawTx1 = await user1.withdraw(1);
    await withdrawTx1.wait();
    const withdrawTx2 = await user2.withdraw(2);
    await withdrawTx2.wait();

    const ethBalanceAfterWithdraw1 = await ethers.provider.getBalance(
      accounts[1].address
    );
    const ethBalanceAfterWithdraw2 = await ethers.provider.getBalance(
      accounts[2].address
    );

    expect(ethBalanceAfterWithdraw1).gt(ethBalanceBeforeWithdraw1);
    expect(ethBalanceAfterWithdraw2).gt(ethBalanceBeforeWithdraw2);

    console.log({ ethBalanceBeforeWithdraw1, ethBalanceAfterWithdraw1 });
    console.log({ ethBalanceBeforeWithdraw2, ethBalanceAfterWithdraw2 });
  });
  it("Two users should be able to deposit at different times and split rewards appropriately", async function () {
    // user1 gets both rewards while user2 only gets the second
    // TODO
  });
  it("When a user deposits/withdraws outside depositRewards they don't receive rewards", async function () {
    // TODO
  });
  it("Should be able to set Votium strategy to 0 ratio and still withdraw value from there while not being able to deposit", async function () {
    // TODO
  });
  it("Should be able to set SafEth strategy to 0 ratio and still withdraw value from there while not being able to deposit", async function () {
    // TODO
  });
  it("Should be able to safely withdraw if requestedWithdraw then added a strategy", async function () {
    // TODO
  });
  it("Should be able to split rewards evenly between votium and safEth", async function () {
    // TODO
  });
  it("Should be able to split rewards between votium (90%) and safEth (10%)", async function () {
    // TODO
  });
  it("Should be able to split rewards between votium (10%) and safEth (90%)", async function () {
    // TODO
  });
  it("Should fail to set invalid strategy contracts", async function () {
    // try to add invalid address to strategies
    await expect(
      afEth.addStrategy(RETH_DERIVATIVE, ethers.utils.parseEther(".5"))
    ).to.be.revertedWith("InvalidStrategy()");
  });
});
