import { AfEth, SafEthStrategy, VotiumErc20Strategy } from "../typechain-types";
import { ethers, network, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { MULTI_SIG, RETH_DERIVATIVE, WST_DERIVATIVE } from "./constants";
import { expect } from "chai";
import { incrementVlcvxEpoch } from "./strategies/VotiumErc20/VotiumTestHelpers";
import { derivativeAbi } from "./abis/derivativeAbi";
import {
  within1Percent,
  within1Pip,
  within2Percent,
  within6Percent,
} from "./helpers/helpers";
import { BigNumber } from "ethers";

describe("Test AfEth", async function () {
  let afEth: AfEth;
  let safEthStrategy: SafEthStrategy;
  let votiumStrategy: VotiumErc20Strategy;
  let accounts: SignerWithAddress[];

  const initialStake = ethers.utils.parseEther(".1");
  const initialStakeAccount = 11;

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
      safEthStrategy.address,
    ])) as VotiumErc20Strategy;
    await votiumStrategy.deployed();

    await afEth.setStrategyAddresses(
      safEthStrategy.address,
      votiumStrategy.address
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
    const tx = await afEth.connect(accounts[initialStakeAccount]).deposit(0, {
      value: initialStake,
    });
    await tx.wait();
  };

  beforeEach(
    async () => await resetToBlock(parseInt(process.env.BLOCK_NUMBER ?? "0"))
  );

  it("Should mint, requestwithdraw, and withdraw afETH", async function () {
    const depositAmount = ethers.utils.parseEther("1");
    const mintTx = await afEth.deposit(0, { value: depositAmount });
    await mintTx.wait();

    const afEthBalanceBeforeRequest = await afEth.balanceOf(
      accounts[0].address
    );
    expect(afEthBalanceBeforeRequest).gt(0);

    const requestWithdrawTx = await afEth.requestWithdraw(
      await afEth.balanceOf(accounts[0].address)
    );
    await requestWithdrawTx.wait();

    const afEthBalanceAfterRequest = await afEth.balanceOf(accounts[0].address);

    for (let i = 0; i < 17; i++) {
      await incrementVlcvxEpoch();
    }

    const withdrawId = await afEth.latestWithdrawId();
    const withdrawInfo = await afEth.withdrawIdInfo(withdrawId);
    expect(withdrawInfo.amount).eq(afEthBalanceBeforeRequest);
    expect(withdrawInfo.owner).eq(accounts[0].address);
    expect(afEthBalanceAfterRequest).eq(0);

    const ethBalanceBeforeWithdraw = await ethers.provider.getBalance(
      accounts[0].address
    );

    const withdrawTx = await afEth.withdraw(withdrawId, 0);
    await withdrawTx.wait();

    const ethBalanceAfterWithdraw = await ethers.provider.getBalance(
      accounts[0].address
    );

    expect(ethBalanceAfterWithdraw).gt(ethBalanceBeforeWithdraw);
  });

  it("Should mint, requestwithdraw, and withdraw afETH with 70/30 (safEth/votium) ratios", async function () {
    const safEthVotiumRatio = ethers.utils.parseEther(".7");
    await afEth.updateRatio(safEthVotiumRatio);

    const user1 = afEth.connect(accounts[1]);

    const votiumBalanceBeforeDeposit1 = await votiumStrategy.balanceOf(
      afEth.address
    );
    const safEthBalanceBeforeDeposit1 = await safEthStrategy.balanceOf(
      afEth.address
    );

    const votiumValueBeforeDeposit1 = votiumBalanceBeforeDeposit1
      .mul(await votiumStrategy.price())
      .div("1000000000000000000");
    const safEthValueBeforeDeposit1 = safEthBalanceBeforeDeposit1
      .mul(await safEthStrategy.price())
      .div("1000000000000000000");

    const depositAmount = ethers.utils.parseEther("1");
    const mintTx = await user1.deposit(0, { value: depositAmount });
    await mintTx.wait();

    const votiumBalanceAfterDeposit1 = await votiumStrategy.balanceOf(
      afEth.address
    );
    const safEthBalanceAfterDeposit1 = await safEthStrategy.balanceOf(
      afEth.address
    );

    const votiumValueAfterDeposit1 = votiumBalanceAfterDeposit1
      .mul(await votiumStrategy.price())
      .div("1000000000000000000");
    const safEthValueAfterDeposit1 = safEthBalanceAfterDeposit1
      .mul(await safEthStrategy.price())
      .div("1000000000000000000");

    const votiumValueGained = votiumValueAfterDeposit1.sub(
      votiumValueBeforeDeposit1
    );
    const safEthValueGained = safEthValueAfterDeposit1.sub(
      safEthValueBeforeDeposit1
    );

    const gainRatio = votiumValueGained
      .mul("1000000000000000000")
      .div(safEthValueGained.add(votiumValueGained));

    const expectedGainRatio = BigNumber.from("1000000000000000000").sub(
      safEthVotiumRatio
    );
    expect(within1Percent(gainRatio, expectedGainRatio)).eq(true);
  });
  it("Should fail to withdraw if epoch for votium hasn't been reached", async function () {
    const depositAmount = ethers.utils.parseEther("1");
    const mintTx = await afEth.deposit(0, { value: depositAmount });
    await mintTx.wait();

    const requestWithdrawTx = await afEth.requestWithdraw(
      await afEth.balanceOf(accounts[0].address)
    );
    await requestWithdrawTx.wait();
    const withdrawId = await afEth.latestWithdrawId();

    await expect(afEth.withdraw(withdrawId, 0)).to.be.revertedWith(
      "CanNotWithdraw()"
    );
  });
  it("Two users should be able to simultaneously deposit the same amount, requestWithdraw, withdraw", async function () {
    const user1 = afEth.connect(accounts[1]);
    const user2 = afEth.connect(accounts[2]);

    const depositAmount = ethers.utils.parseEther("1");

    const mintTx1 = await user1.deposit(0, { value: depositAmount });
    await mintTx1.wait();
    const mintTx2 = await user2.deposit(0, { value: depositAmount });
    await mintTx2.wait();

    const afEthBalanceBeforeRequest1 = await user1.balanceOf(
      accounts[1].address
    );
    const afEthBalanceBeforeRequest2 = await user2.balanceOf(
      accounts[2].address
    );

    expect(
      within1Percent(afEthBalanceBeforeRequest1, afEthBalanceBeforeRequest2)
    );

    const requestWithdrawTx1 = await user1.requestWithdraw(
      await afEth.balanceOf(accounts[1].address)
    );
    await requestWithdrawTx1.wait();
    const requestWithdrawTx2 = await user2.requestWithdraw(
      await afEth.balanceOf(accounts[2].address)
    );
    await requestWithdrawTx2.wait();

    for (let i = 0; i < 17; i++) {
      await incrementVlcvxEpoch();
    }

    const withdrawInfo1 = await afEth.withdrawIdInfo(1);
    const withdrawInfo2 = await afEth.withdrawIdInfo(2);

    expect(within1Percent(withdrawInfo1.amount, withdrawInfo2.amount)).eq(true);
    expect(withdrawInfo1.owner).eq(accounts[1].address);
    expect(withdrawInfo2.owner).eq(accounts[2].address);

    const ethBalanceBeforeWithdraw1 = await ethers.provider.getBalance(
      accounts[1].address
    );
    const ethBalanceBeforeWithdraw2 = await ethers.provider.getBalance(
      accounts[2].address
    );

    const withdrawTx1 = await user1.withdraw(1, 0);
    await withdrawTx1.wait();
    const withdrawTx2 = await user2.withdraw(2, 0);
    await withdrawTx2.wait();

    const ethBalanceAfterWithdraw1 = await ethers.provider.getBalance(
      accounts[1].address
    );
    const ethBalanceAfterWithdraw2 = await ethers.provider.getBalance(
      accounts[2].address
    );
    const ethReceived1 = ethBalanceAfterWithdraw1.sub(
      ethBalanceBeforeWithdraw1
    );
    const ethReceived2 = ethBalanceAfterWithdraw2.sub(
      ethBalanceBeforeWithdraw2
    );

    expect(ethBalanceAfterWithdraw1).gt(ethBalanceBeforeWithdraw1);
    expect(ethBalanceAfterWithdraw2).gt(ethBalanceBeforeWithdraw2);

    expect(within1Percent(ethReceived1, ethReceived2)).eq(true);
    expect(within1Percent(ethReceived2, depositAmount)).eq(true);
  });
  it("Two users should be able to simultaneously deposit the same amount, requestWithdraw, withdraw and split rewards", async function () {
    const user1 = afEth.connect(accounts[1]);
    const user2 = afEth.connect(accounts[2]);

    const depositAmount = ethers.utils.parseEther("1");

    const mintTx1 = await user1.deposit(0, { value: depositAmount });
    await mintTx1.wait();
    const mintTx2 = await user2.deposit(0, { value: depositAmount });
    await mintTx2.wait();

    const afEthBalanceBeforeRequest1 = await user1.balanceOf(
      accounts[1].address
    );
    const afEthBalanceBeforeRequest2 = await user2.balanceOf(
      accounts[2].address
    );

    expect(
      within1Percent(afEthBalanceBeforeRequest1, afEthBalanceBeforeRequest2)
    );

    const tx = await afEth.depositRewards(depositAmount, {
      value: depositAmount,
    });
    await tx.wait();

    const requestWithdrawTx1 = await user1.requestWithdraw(
      await afEth.balanceOf(accounts[1].address)
    );
    await requestWithdrawTx1.wait();
    const requestWithdrawTx2 = await user2.requestWithdraw(
      await afEth.balanceOf(accounts[2].address)
    );
    await requestWithdrawTx2.wait();

    for (let i = 0; i < 17; i++) {
      await incrementVlcvxEpoch();
    }

    const withdrawInfo1 = await afEth.withdrawIdInfo(1);
    const withdrawInfo2 = await afEth.withdrawIdInfo(2);

    expect(within1Percent(withdrawInfo1.amount, withdrawInfo2.amount)).eq(true);
    expect(withdrawInfo1.owner).eq(accounts[1].address);
    expect(withdrawInfo2.owner).eq(accounts[2].address);

    const ethBalanceBeforeWithdraw1 = await ethers.provider.getBalance(
      accounts[1].address
    );
    const ethBalanceBeforeWithdraw2 = await ethers.provider.getBalance(
      accounts[2].address
    );

    const withdrawTx1 = await user1.withdraw(1, 0);
    await withdrawTx1.wait();
    const withdrawTx2 = await user2.withdraw(2, 0);
    await withdrawTx2.wait();

    const ethBalanceAfterWithdraw1 = await ethers.provider.getBalance(
      accounts[1].address
    );
    const ethBalanceAfterWithdraw2 = await ethers.provider.getBalance(
      accounts[2].address
    );
    const ethReceived1 = ethBalanceAfterWithdraw1.sub(
      ethBalanceBeforeWithdraw1
    );
    const ethReceived2 = ethBalanceAfterWithdraw2.sub(
      ethBalanceBeforeWithdraw2
    );

    expect(ethBalanceAfterWithdraw1).gt(ethBalanceBeforeWithdraw1);
    expect(ethBalanceAfterWithdraw2).gt(ethBalanceBeforeWithdraw2);

    expect(within1Percent(ethReceived1, ethReceived2)).eq(true);

    const rewardAmount1 = ethReceived1.sub(depositAmount);
    const rewardAmount2 = ethReceived2.sub(depositAmount);

    expect(within1Percent(rewardAmount1, rewardAmount2)).eq(true);
  });
  it("Two users should be able to deposit at different times and split rewards appropriately", async function () {
    // user1 gets both rewards while user2 only gets the second
    const user1 = afEth.connect(accounts[1]);
    const user2 = afEth.connect(accounts[2]);

    const depositAmount = ethers.utils.parseEther("1");

    const rewardAmount = ethers.utils.parseEther("1");

    const mintTx1 = await user1.deposit(0, { value: depositAmount });
    await mintTx1.wait();

    let user1BalanceRatio = (await afEth.balanceOf(accounts[1].address))
      .mul(ethers.utils.parseEther("1"))
      .div((await afEth.totalSupply()).toString());

    const expectedUser1Reward1 = BigNumber.from(rewardAmount)
      .mul(user1BalanceRatio)
      .div(ethers.utils.parseEther("1"));

    let tx = await afEth.depositRewards(depositAmount, {
      value: rewardAmount,
    });
    await tx.wait();

    tx = await user2.deposit(0, { value: depositAmount });
    await tx.wait();

    user1BalanceRatio = (await afEth.balanceOf(accounts[1].address))
      .mul(ethers.utils.parseEther("1"))
      .div((await afEth.totalSupply()).toString());
    const user2BalanceRatio = (await afEth.balanceOf(accounts[2].address))
      .mul(ethers.utils.parseEther("1"))
      .div((await afEth.totalSupply()).toString());

    const expectedUser1Reward2 = BigNumber.from(rewardAmount)
      .mul(user1BalanceRatio)
      .div(ethers.utils.parseEther("1"));
    const expectedUser2Reward = BigNumber.from(rewardAmount)
      .mul(user2BalanceRatio)
      .div(ethers.utils.parseEther("1"));

    tx = await afEth.depositRewards(depositAmount, {
      value: rewardAmount,
    });
    await tx.wait();

    const requestWithdrawTx1 = await user1.requestWithdraw(
      await afEth.balanceOf(accounts[1].address)
    );
    await requestWithdrawTx1.wait();

    const requestWithdrawTx2 = await user2.requestWithdraw(
      await afEth.balanceOf(accounts[2].address)
    );
    await requestWithdrawTx2.wait();

    for (let i = 0; i < 17; i++) {
      await incrementVlcvxEpoch();
    }

    const ethBalanceBeforeWithdraw1 = await ethers.provider.getBalance(
      accounts[1].address
    );
    const withdrawTx1 = await user1.withdraw(1, 0);
    await withdrawTx1.wait();

    const ethReceived1 = (
      await ethers.provider.getBalance(accounts[1].address)
    ).sub(ethBalanceBeforeWithdraw1);

    const ethBalanceBeforeWithdraw2 = await ethers.provider.getBalance(
      accounts[2].address
    );
    const withdrawTx2 = await user2.withdraw(2, 0);
    await withdrawTx2.wait();

    const ethReceived2 = (
      await ethers.provider.getBalance(accounts[2].address)
    ).sub(ethBalanceBeforeWithdraw2);

    const rewardAmount1 = ethReceived1.sub(depositAmount);
    const rewardAmount2 = ethReceived2.sub(depositAmount);

    const totalUser1ExpectedReward =
      expectedUser1Reward1.add(expectedUser1Reward2);

    expect(within1Percent(rewardAmount1, totalUser1ExpectedReward)).eq(true);
    expect(
      within2Percent(rewardAmount2, BigNumber.from(expectedUser2Reward))
    ).eq(true);
  });

  it("When a user deposits/withdraws outside depositRewards they don't receive rewards", async function () {
    const user1 = afEth.connect(accounts[1]);
    const user2 = afEth.connect(accounts[2]);

    const depositAmount = ethers.utils.parseEther("1");

    const mintTx1 = await user1.deposit(0, { value: depositAmount });
    await mintTx1.wait();

    const tx = await afEth.depositRewards(depositAmount, {
      value: depositAmount,
    });
    await tx.wait();

    const mintTx2 = await user2.deposit(0, { value: depositAmount });
    let mined = await mintTx2.wait();

    const afEthBalanceBeforeRequest1 = await afEth.balanceOf(
      accounts[1].address
    );
    const afEthBalanceBeforeRequest2 = await afEth.balanceOf(
      accounts[2].address
    );

    expect(
      within1Percent(afEthBalanceBeforeRequest1, afEthBalanceBeforeRequest2)
    );

    const requestWithdrawTx1 = await user1.requestWithdraw(
      await afEth.balanceOf(accounts[1].address)
    );
    await requestWithdrawTx1.wait();
    const requestWithdrawTx2 = await user2.requestWithdraw(
      await afEth.balanceOf(accounts[2].address)
    );
    mined = await requestWithdrawTx2.wait();

    for (let i = 0; i < 17; i++) {
      await incrementVlcvxEpoch();
    }

    const withdrawInfo1 = await afEth.withdrawIdInfo(1);
    const withdrawInfo2 = await afEth.withdrawIdInfo(2);

    // it's not exactly double due to the initial stake of .1 ETH
    expect(
      within6Percent(withdrawInfo1.amount.div(2), withdrawInfo2.amount)
    ).eq(true);
    expect(withdrawInfo1.owner).eq(accounts[1].address);
    expect(withdrawInfo2.owner).eq(accounts[2].address);

    const ethBalanceBeforeWithdraw1 = await ethers.provider.getBalance(
      accounts[1].address
    );
    const ethBalanceBeforeWithdraw2 = await ethers.provider.getBalance(
      accounts[2].address
    );

    const withdrawTx1 = await user1.withdraw(1, 0);
    await withdrawTx1.wait();
    const withdrawTx2 = await user2.withdraw(2, 0);
    mined = await withdrawTx2.wait();
    const withdrawGasUsed2 = mined.gasUsed.mul(mined.effectiveGasPrice);

    const ethBalanceAfterWithdraw1 = await ethers.provider.getBalance(
      accounts[1].address
    );
    const ethBalanceAfterWithdraw2 = await ethers.provider.getBalance(
      accounts[2].address
    );
    const ethReceived1 = ethBalanceAfterWithdraw1.sub(
      ethBalanceBeforeWithdraw1
    );
    const ethReceived2 = ethBalanceAfterWithdraw2.sub(
      ethBalanceBeforeWithdraw2
    );

    expect(ethBalanceAfterWithdraw1).gt(ethBalanceBeforeWithdraw1);
    expect(ethBalanceAfterWithdraw2).gt(ethBalanceBeforeWithdraw2);

    const rewardAmount1 = ethReceived1.sub(depositAmount);
    const rewardAmount2 = ethReceived2.sub(depositAmount).add(withdrawGasUsed2); // calculating gas for this one to compare with zero

    // would be 1 ether worth, but since there is a .1 ETH deposit to not allow contract to be emptied they receive ~90% of the rewards
    expect(
      within1Percent(
        rewardAmount1,
        // deposit amount minus initial stake
        depositAmount.sub(
          depositAmount.mul(initialStake).div(ethers.utils.parseEther("1"))
        )
      )
    ).eq(true);

    // slightly negative due to slippage, this user shouldn't receive any rewards
    expect(rewardAmount2).lt(0);
    expect(rewardAmount2).gt(ethers.utils.parseEther("-0.006"));
  });
  it("Should be able to set Votium strategy to 0 ratio and still withdraw value from there while not being able to deposit", async function () {
    const user1 = afEth.connect(accounts[1]);

    const votiumBalanceBeforeDeposit1 = await votiumStrategy.balanceOf(
      afEth.address
    );
    const safEthBalanceBeforeDeposit1 = await safEthStrategy.balanceOf(
      afEth.address
    );

    const depositAmount = ethers.utils.parseEther("1");
    let mintTx = await user1.deposit(0, { value: depositAmount });
    await mintTx.wait();

    const votiumBalanceAfterDeposit1 = await votiumStrategy.balanceOf(
      afEth.address
    );
    const safEthBalanceAfterDeposit1 = await safEthStrategy.balanceOf(
      afEth.address
    );

    const afEthBalanceBeforeRequest = await user1.balanceOf(
      accounts[1].address
    );
    expect(afEthBalanceBeforeRequest).gt(0);

    // set votium strategy to 0 ratio
    await afEth.updateRatio("1000000000000000000"); // 100% safEth strategy

    const requestWithdrawTx = await user1.requestWithdraw(
      await afEth.balanceOf(accounts[1].address)
    );
    await requestWithdrawTx.wait();

    const afEthBalanceAfterRequest = await user1.balanceOf(accounts[1].address);

    for (let i = 0; i < 17; i++) {
      await incrementVlcvxEpoch();
    }

    const withdrawId = await user1.latestWithdrawId();
    const withdrawInfo = await user1.withdrawIdInfo(withdrawId);
    expect(withdrawInfo.amount).eq(afEthBalanceBeforeRequest);
    expect(withdrawInfo.owner).eq(accounts[1].address);
    expect(afEthBalanceAfterRequest).eq(0);

    const ethBalanceBeforeWithdraw = await ethers.provider.getBalance(
      accounts[1].address
    );

    const withdrawTx = await user1.withdraw(withdrawId, 0);
    await withdrawTx.wait();

    const ethBalanceAfterWithdraw = await ethers.provider.getBalance(
      accounts[1].address
    );
    const ethReceived = ethBalanceAfterWithdraw.sub(ethBalanceBeforeWithdraw);

    expect(ethBalanceAfterWithdraw).gt(ethBalanceBeforeWithdraw);
    expect(within1Percent(ethReceived, depositAmount)).eq(true);

    const votiumBalanceAfterWithdraw = await votiumStrategy.balanceOf(
      afEth.address
    );
    const safEthBalanceAfterWithdraw = await safEthStrategy.balanceOf(
      afEth.address
    );

    mintTx = await user1.deposit(0, { value: depositAmount });
    await mintTx.wait();

    const votiumBalanceAfterDeposit2 = await votiumStrategy.balanceOf(
      afEth.address
    );
    const safEthBalanceAfterDeposit2 = await safEthStrategy.balanceOf(
      afEth.address
    );

    expect(
      within1Percent(votiumBalanceBeforeDeposit1, votiumBalanceAfterWithdraw)
    );
    expect(
      within1Percent(safEthBalanceBeforeDeposit1, safEthBalanceAfterWithdraw)
    );
    expect(
      within1Percent(safEthBalanceBeforeDeposit1, safEthBalanceAfterWithdraw)
    );

    // Votium doesn't get more tokens once set to 0 ratio
    expect(
      within1Percent(votiumBalanceBeforeDeposit1, votiumBalanceAfterDeposit2)
    );

    expect(safEthBalanceAfterDeposit2).gt(safEthBalanceAfterWithdraw);
    expect(votiumBalanceAfterDeposit1).gt(votiumBalanceBeforeDeposit1);
    expect(safEthBalanceAfterDeposit1).gt(safEthBalanceBeforeDeposit1);
  });
  it("Should be able to set SafEth strategy to 0 ratio and still withdraw value from there while not being able to deposit", async function () {
    const user1 = afEth.connect(accounts[1]);

    const votiumBalanceBeforeDeposit1 = await votiumStrategy.balanceOf(
      afEth.address
    );
    const safEthBalanceBeforeDeposit1 = await safEthStrategy.balanceOf(
      afEth.address
    );

    const depositAmount = ethers.utils.parseEther("1");
    let mintTx = await user1.deposit(0, { value: depositAmount });
    await mintTx.wait();

    const votiumBalanceAfterDeposit1 = await votiumStrategy.balanceOf(
      afEth.address
    );
    const safEthBalanceAfterDeposit1 = await safEthStrategy.balanceOf(
      afEth.address
    );

    const afEthBalanceBeforeRequest = await user1.balanceOf(
      accounts[1].address
    );
    expect(afEthBalanceBeforeRequest).gt(0);

    // set safEth strategy to 0 ratio
    await afEth.updateRatio(0);

    const requestWithdrawTx = await user1.requestWithdraw(
      await afEth.balanceOf(accounts[1].address)
    );
    await requestWithdrawTx.wait();

    const afEthBalanceAfterRequest = await user1.balanceOf(accounts[1].address);

    for (let i = 0; i < 17; i++) {
      await incrementVlcvxEpoch();
    }

    const withdrawId = await user1.latestWithdrawId();
    const withdrawInfo = await user1.withdrawIdInfo(withdrawId);
    expect(withdrawInfo.amount).eq(afEthBalanceBeforeRequest);
    expect(withdrawInfo.owner).eq(accounts[1].address);
    expect(afEthBalanceAfterRequest).eq(0);

    const ethBalanceBeforeWithdraw = await ethers.provider.getBalance(
      accounts[1].address
    );

    const withdrawTx = await user1.withdraw(withdrawId, 0);
    await withdrawTx.wait();

    const ethBalanceAfterWithdraw = await ethers.provider.getBalance(
      accounts[1].address
    );
    const ethReceived = ethBalanceAfterWithdraw.sub(ethBalanceBeforeWithdraw);

    expect(ethBalanceAfterWithdraw).gt(ethBalanceBeforeWithdraw);
    expect(within1Percent(ethReceived, depositAmount)).eq(true);

    const votiumBalanceAfterWithdraw = await votiumStrategy.balanceOf(
      afEth.address
    );
    const safEthBalanceAfterWithdraw = await safEthStrategy.balanceOf(
      afEth.address
    );

    mintTx = await user1.deposit(0, { value: depositAmount });
    await mintTx.wait();

    const votiumBalanceAfterDeposit2 = await votiumStrategy.balanceOf(
      afEth.address
    );
    const safEthBalanceAfterDeposit2 = await safEthStrategy.balanceOf(
      afEth.address
    );

    expect(
      within1Percent(votiumBalanceBeforeDeposit1, votiumBalanceAfterWithdraw)
    );
    expect(
      within1Percent(safEthBalanceBeforeDeposit1, safEthBalanceAfterWithdraw)
    );
    expect(
      within1Percent(safEthBalanceBeforeDeposit1, safEthBalanceAfterWithdraw)
    );

    // safEth doesn't get more tokens once set to 0 ratio
    expect(
      within1Percent(safEthBalanceBeforeDeposit1, safEthBalanceAfterDeposit2)
    );

    expect(votiumBalanceAfterDeposit2).gt(votiumBalanceAfterWithdraw);
    expect(votiumBalanceAfterDeposit1).gt(votiumBalanceBeforeDeposit1);
    expect(safEthBalanceAfterDeposit1).gt(safEthBalanceBeforeDeposit1);
  });
  it.only("Should show rewards push the ratio towards the target ratio", async function () {
    // user1 gets both rewards while user2 only gets the second
    const user1 = afEth.connect(accounts[1]);

    const initialDepositAmount = ethers.utils.parseEther("2");

    const rewardAmount = ethers.utils.parseEther("1");

    const mintTx1 = await user1.deposit(0, { value: initialDepositAmount });
    await mintTx1.wait();

    // update from 50% safEth to 90% safEth
    await afEth.updateRatio(ethers.utils.parseEther("0.9"));

    let votiumBalance = await votiumStrategy.balanceOf(afEth.address);
    let safEthBalance = await safEthStrategy.balanceOf(afEth.address);

    let votiumValue = votiumBalance
      .mul(await votiumStrategy.price())
      .div("1000000000000000000");
    let safEthValue = safEthBalance
      .mul(await safEthStrategy.price())
      .div("1000000000000000000");

    votiumValue = votiumBalance
      .mul(await votiumStrategy.price())
      .div("1000000000000000000");
    safEthValue = safEthBalance
      .mul(await safEthStrategy.price())
      .div("1000000000000000000");
    let ratio = safEthValue
      .mul("1000000000000000000")
      .div(safEthValue.add(votiumValue));

    console.log("ratio is", ethers.utils.formatEther(ratio));
//    console.log("ratioInverted is", ethers.utils.formatEther(ratioInverted));

    // // show that it approaches 90% safEth as deposits are added
    // for (let i = 0; i < 20; i++) {
    //   const tx = await afEth.depositRewards(rewardAmount, {
    //     value: rewardAmount,
    //   });
    //   await tx.wait();

    //   votiumBalance = await votiumStrategy.balanceOf(afEth.address);
    //   safEthBalance = await safEthStrategy.balanceOf(afEth.address);

    //   votiumValue = votiumBalance
    //     .mul(await votiumStrategy.price())
    //     .div("1000000000000000000");
    //   safEthValue = safEthBalance
    //     .mul(await safEthStrategy.price())
    //     .div("1000000000000000000");

    //   ratio = votiumValue.mul("1000000000000000000").div(safEthValue);
    //   ratioInverted = BigNumber.from("1000000000000000000").sub(ratio);

    //   console.log("ratio is", ethers.utils.formatEther(ratio));
    //   console.log("ratioInverted is", ethers.utils.formatEther(ratioInverted));
    // }
  });
  it("Should be able to pause deposit & withdraw", async function () {
    const depositAmount = ethers.utils.parseEther("1");
    await afEth.setPauseDeposit(true);
    await expect(afEth.deposit(0, { value: depositAmount })).to.be.revertedWith(
      "Paused()"
    );
    await afEth.setPauseDeposit(false);
    const mintTx = await afEth.deposit(0, { value: depositAmount });
    await mintTx.wait();

    const afEthBalanceBeforeRequest = await afEth.balanceOf(
      accounts[0].address
    );
    expect(afEthBalanceBeforeRequest).gt(0);

    await afEth.setPauseWithdraw(true);
    await expect(
      afEth.requestWithdraw(await afEth.balanceOf(accounts[0].address))
    ).to.be.revertedWith("Paused()");
    await afEth.setPauseWithdraw(false);

    const requestWithdrawTx = await afEth.requestWithdraw(
      await afEth.balanceOf(accounts[0].address)
    );
    await requestWithdrawTx.wait();

    const afEthBalanceAfterRequest = await afEth.balanceOf(accounts[0].address);

    for (let i = 0; i < 17; i++) {
      await incrementVlcvxEpoch();
    }

    const withdrawId = await afEth.latestWithdrawId();
    const withdrawInfo = await afEth.withdrawIdInfo(withdrawId);
    expect(withdrawInfo.amount).eq(afEthBalanceBeforeRequest);
    expect(withdrawInfo.owner).eq(accounts[0].address);
    expect(afEthBalanceAfterRequest).eq(0);

    const ethBalanceBeforeWithdraw = await ethers.provider.getBalance(
      accounts[0].address
    );

    await afEth.setPauseWithdraw(true);
    await expect(afEth.withdraw(withdrawId, 0)).to.be.revertedWith("Paused()");
    await afEth.setPauseWithdraw(false);
    const withdrawTx = await afEth.withdraw(withdrawId, 0);
    await withdrawTx.wait();

    const ethBalanceAfterWithdraw = await ethers.provider.getBalance(
      accounts[0].address
    );

    expect(ethBalanceAfterWithdraw).gt(ethBalanceBeforeWithdraw);
  });
  it("Should test withdrawTime() and canWithdraw()", async function () {
    const depositAmount = ethers.utils.parseEther("1");
    const mintTx = await afEth.deposit(0, { value: depositAmount });
    await mintTx.wait();

    const afEthBalanceBeforeRequest = await afEth.balanceOf(
      accounts[0].address
    );
    expect(afEthBalanceBeforeRequest).gt(0);

    const requestWithdrawTx = await afEth.requestWithdraw(
      afEthBalanceBeforeRequest
    );
    await requestWithdrawTx.wait();

    const withdrawId = await afEth.latestWithdrawId();

    const withdrawTime = await afEth.withdrawTime(afEthBalanceBeforeRequest);
    while (true) {
      const currentBlockTime = (await ethers.provider.getBlock("latest"))
        .timestamp;
      if (BigNumber.from(currentBlockTime).gt(withdrawTime)) {
        expect(await afEth.canWithdraw(withdrawId)).eq(true);
        break;
      } else {
        expect(await afEth.canWithdraw(withdrawId)).eq(false);
      }
      await incrementVlcvxEpoch();
    }
  });

  it("Should not mint if minting less than minout", async function () {
    const depositAmount = ethers.utils.parseEther("1");

    // mint once to sdee how much afEth is received for depositAmount
    const mintTx = await afEth.deposit(0, { value: depositAmount });
    await mintTx.wait();

    const afEthBalance1 = await afEth.balanceOf(accounts[0].address);

    // mint again with a minout high enough to to revert

    await expect(
      afEth.deposit(afEthBalance1.mul(2), {
        value: depositAmount,
      })
    ).to.be.revertedWith("BelowMinOut()");
    await mintTx.wait();
  });

  it("Should not withdraw if withdrawing less than minout", async function () {
    const depositAmount = ethers.utils.parseEther("1");
    const mintTx = await afEth.deposit(0, { value: depositAmount });
    await mintTx.wait();

    const afEthBalanceBeforeRequest = await afEth.balanceOf(
      accounts[0].address
    );
    expect(afEthBalanceBeforeRequest).gt(0);

    const requestWithdrawTx = await afEth.requestWithdraw(
      await afEth.balanceOf(accounts[0].address)
    );
    await requestWithdrawTx.wait();

    for (let i = 0; i < 17; i++) {
      await incrementVlcvxEpoch();
    }

    const withdrawId = await afEth.latestWithdrawId();

    await expect(
      afEth.withdraw(withdrawId, depositAmount.mul(2))
    ).to.be.revertedWith("BelowMinOut()");
  });

  it("Should be able to deposit rewards to all strategies", async function () {
    const depositAmount = ethers.utils.parseEther("1");
    const rewardAmount = ethers.utils.parseEther("1");
    const mintTx = await afEth.deposit(0, { value: depositAmount });
    await mintTx.wait();

    const afEthPrice0 = await afEth.price();
    const votiumStrategyPrice0 = await votiumStrategy.price();
    const safEthStrategyPrice0 = await safEthStrategy.price();
    const safEthStrategyTotalSupply0 = await safEthStrategy.totalSupply();

    let tx = await afEth.depositRewards(rewardAmount, {
      value: rewardAmount,
    });
    await tx.wait();

    // first reward -- votium unchanged, safEth unchnaged but in price (but supply goes up), afEth price goes up
    expect(await afEth.price()).gt(afEthPrice0);
    expect(within1Pip(await safEthStrategy.price(), safEthStrategyPrice0)); // within 1 pip because safEth goes up every block
    expect(await safEthStrategy.totalSupply()).gt(safEthStrategyTotalSupply0);
    expect(await votiumStrategy.price()).eq(votiumStrategyPrice0);

    const afEthPrice1 = await afEth.price();
    const votiumStrategyPrice1 = await votiumStrategy.price();
    const safEthStrategyPrice1 = await safEthStrategy.price();
    const safEthStrategyTotalSupply1 = await safEthStrategy.totalSupply();

    tx = await afEth.depositRewards(rewardAmount, {
      value: rewardAmount,
    });
    await tx.wait();

    // second reward --safEth price unchanged (and supply unchanged), votium goes up, afEth goes up
    expect(await afEth.price()).gt(afEthPrice1);
    expect(within1Pip(await safEthStrategy.price(), safEthStrategyPrice1)); // within 1 pip because safEth goes up every block
    expect(await votiumStrategy.price()).eq(votiumStrategyPrice1);
    expect(await safEthStrategy.totalSupply()).gt(safEthStrategyTotalSupply1);
  });
});
