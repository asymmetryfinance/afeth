import { AfEth, SafEthStrategy, VotiumErc20Strategy } from "../typechain-types";
import { ethers, network, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { MULTI_SIG, RETH_DERIVATIVE, WST_DERIVATIVE } from "./constants";
import { expect } from "chai";
import { incrementVlcvxEpoch } from "./strategies/VotiumErc20/VotiumTestHelpers";
import { derivativeAbi } from "./abis/derivativeAbi";

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

    expect(await afEth.withdraw(withdrawId)).to.be.revertedWith(
      "CanNotWithdraw()"
    );
  });
  it("Two users should be able to deposit, requestWithdraw, withdraw full positions when votium can be withdrawn", async function () {
    const user1 = afEth.connect(accounts[1]);
    const user2 = afEth.connect(accounts[2]);

    const depositAmount = ethers.utils.parseEther("1");

    const mintTx = await user1.deposit({ value: depositAmount });
    await mintTx.wait();

    const mintedAfEthAmount = "1000075263435139093";

    const afEthBalanceBeforeRequest = await user1.balanceOf(
      accounts[0].address
    );
    expect(afEthBalanceBeforeRequest).eq(mintedAfEthAmount);

    const requestWithdrawTx = await user1.requestWithdraw();
    await requestWithdrawTx.wait();

    const afEthBalanceAfterRequest = await user1.balanceOf(accounts[0].address);

    for (let i = 0; i < 17; i++) {
      await incrementVlcvxEpoch();
    }

    const withdrawId = await user1.latestWithdrawId();
    const withdrawInfo = await user1.withdrawIdInfo(withdrawId);
    expect(withdrawInfo.amount).eq(mintedAfEthAmount);
    expect(withdrawInfo.owner).eq(accounts[0].address);
    expect(afEthBalanceAfterRequest).eq(0);

    const ethBalanceBeforeWithdraw = await ethers.provider.getBalance(
      accounts[0].address
    );

    const withdrawTx = await user1.withdraw(withdrawId);
    await withdrawTx.wait();

    const ethBalanceAfterWithdraw = await ethers.provider.getBalance(
      accounts[0].address
    );

    expect(ethBalanceAfterWithdraw).gt(ethBalanceBeforeWithdraw);
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
  it("Should be able to safely withdraw if requestedWithdraw then added a strategy", async function () {
    // TODO
  });
  it("Should fail to set invalid strategy contracts", async function () {
    // try to add invalid address to strategies
    await expect(
      afEth.addStrategy(RETH_DERIVATIVE, ethers.utils.parseEther(".5"))
    ).to.be.revertedWith("InvalidStrategy()");
  });
});
