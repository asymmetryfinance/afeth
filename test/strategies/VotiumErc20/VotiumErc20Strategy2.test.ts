import { network, ethers, upgrades } from "hardhat";
import { VotiumErc20Strategy } from "../../../typechain-types";
import { expect } from "chai";
import {
  getCurrentEpoch,
  incrementVlcvxEpoch,
  oracleApplyRewards,
  readJSONFromFile,
} from "./VotiumTestHelpers";
import {
  within1Percent,
  within1Pip,
  within2Percent,
} from "../../helpers/helpers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

describe("Test VotiumErc20Strategy (Part 2)", async function () {
  let votiumStrategy: VotiumErc20Strategy;
  let accounts: SignerWithAddress[];
  let rewarderAccount: SignerWithAddress;
  let userAccount: SignerWithAddress;
  let ownerAccount: SignerWithAddress;

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
    userAccount = accounts[0];
    rewarderAccount = accounts[1];
    ownerAccount = accounts[2];

    const votiumStrategyFactory = await ethers.getContractFactory(
      "VotiumErc20Strategy"
    );
    votiumStrategy = (await upgrades.deployProxy(votiumStrategyFactory, [
      ownerAccount.address,
      rewarderAccount.address,
    ])) as VotiumErc20Strategy;
    await votiumStrategy.deployed();

    // mint some to seed the system so totalSupply is never 0 (prevent price weirdness on withdraw)
    const tx = await votiumStrategy.connect(accounts[11]).mint({
      value: ethers.utils.parseEther("0.000001"),
    });
    await tx.wait();
  };

  beforeEach(
    async () => await resetToBlock(parseInt(process.env.BLOCK_NUMBER ?? "0"))
  );

  it("Should allow user to withdraw ~original deposit if owner reward functions are never called", async function () {
    let tx = await votiumStrategy.mint({
      value: ethers.utils.parseEther("1"),
    });
    await tx.wait();

    tx = await votiumStrategy.requestWithdraw(
      await votiumStrategy.balanceOf(userAccount.address)
    );
    const mined1 = await tx.wait();
    const totalGasFees1 = mined1.gasUsed.mul(mined1.effectiveGasPrice);

    const event = mined1?.events?.find((e) => e?.event === "WithdrawRequest");

    const unlockEpoch = event?.args?.unlockEpoch;

    const currentEpoch = await getCurrentEpoch();

    const epochsUntilUnlock = unlockEpoch.sub(currentEpoch);

    for (let i = 0; i < epochsUntilUnlock; i++) {
      await incrementVlcvxEpoch();
    }

    const ethBalanceBefore = await ethers.provider.getBalance(
      userAccount.address
    );

    tx = await votiumStrategy.withdraw(unlockEpoch);
    const mined2 = await tx.wait();

    const totalGasFees2 = mined2.gasUsed.mul(mined2.effectiveGasPrice);

    const totalGasFees = totalGasFees1.add(totalGasFees2);

    const ethBalanceAfter = await ethers.provider.getBalance(
      userAccount.address
    );

    expect(within1Pip(ethBalanceBefore, ethBalanceAfter.add(totalGasFees))).eq(
      true
    );
  });
  it("Should only allow the rewarder to applyRewards()", async function () {
    let tx = await votiumStrategy.mint({
      value: ethers.utils.parseEther("1"),
    });
    await tx.wait();

    tx = await votiumStrategy.requestWithdraw(
      await votiumStrategy.balanceOf(userAccount.address)
    );
    await tx.wait();

    // this shouldnt throw
    await oracleApplyRewards(rewarderAccount, votiumStrategy.address);

    // this should throw
    try {
      await oracleApplyRewards(userAccount, votiumStrategy.address);
    } catch (e: any) {
      expect(e.message).eq(
        "VM Exception while processing transaction: reverted with reason string 'not rewarder'"
      );
    }
  });
  it("Should not be able to requestWithdraw for more than a users balance", async function () {
    const tx = await votiumStrategy.mint({
      value: ethers.utils.parseEther("1"),
    });
    await tx.wait();

    const tooMuch = (await votiumStrategy.balanceOf(userAccount.address)).add(
      1
    );

    await expect(votiumStrategy.requestWithdraw(tooMuch)).to.be.revertedWith(
      "ERC20: transfer amount exceeds balance"
    );
  });
  it("Should decrease users balance when requestWithdraw is called", async function () {
    let tx = await votiumStrategy.mint({
      value: ethers.utils.parseEther("1"),
    });
    await tx.wait();

    const balanceBefore = await votiumStrategy.balanceOf(userAccount.address);

    const halfBalance = balanceBefore.div(2);
    tx = await votiumStrategy.requestWithdraw(halfBalance);
    await tx.wait();

    const balanceAfter = await votiumStrategy.balanceOf(userAccount.address);

    expect(balanceAfter).eq(balanceBefore.sub(halfBalance));
  });
  it("Should be able to sell a large portion of all votium rewards into eth with minimal slippage", async function () {
    const tx = await votiumStrategy.mint({
      value: ethers.utils.parseEther("1"),
    });
    await tx.wait();

    const sellEventSmall = await oracleApplyRewards(
      rewarderAccount,
      votiumStrategy.address,
      await readJSONFromFile("./scripts/testDataSlippageSmall.json")
    );
    const ethReceived0 = sellEventSmall?.args?.ethAmount;

    const sellEventLarge = await oracleApplyRewards(
      rewarderAccount,
      votiumStrategy.address,
      await readJSONFromFile("./scripts/testDataSlippage.json")
    );
    const ethReceived1 = sellEventLarge?.args?.ethAmount;

    // second sell should be 100x the first sell
    const expectedEthReceived1 = ethReceived0.mul(100);
    expect(within2Percent(ethReceived1, expectedEthReceived1)).eq(true);
  });

  it("Should be able to deposit 100 eth depositRewards() with minimal slippage and price go up", async function () {
    const depositAmountSmall = ethers.utils.parseEther("0.1");
    const depositAmountLarge = ethers.utils.parseEther("100");

    const tx1 = await votiumStrategy.depositRewards(depositAmountSmall, {
      value: depositAmountSmall,
    });
    const mined1 = await tx1.wait();
    const e1 = mined1.events?.find((e) => e.event === "DepositReward");
    const cvxOut1 = e1?.args?.cvxAmount;

    const tx2 = await votiumStrategy.depositRewards(depositAmountLarge, {
      value: depositAmountLarge,
    });
    const mined2 = await tx2.wait();
    const e2 = mined2.events?.find((e) => e.event === "DepositReward");
    const cvxOut2 = e2?.args?.cvxAmount;

    const expectedCvxOut2 = cvxOut1.mul(1000);

    expect(within1Percent(cvxOut2, expectedCvxOut2)).eq(true);
  });
  it("Should not change the price when minting, requesting withdraw or withdrawing", async function () {
    const price0 = await votiumStrategy.price();

    let tx = await votiumStrategy.mint({
      value: ethers.utils.parseEther("1"),
    });
    await tx.wait();

    const price1 = await votiumStrategy.price();

    tx = await votiumStrategy.requestWithdraw(
      await votiumStrategy.balanceOf(accounts[0].address)
    );
    const mined = await tx.wait();

    const price2 = await votiumStrategy.price();

    const event = mined?.events?.find((e) => e?.event === "WithdrawRequest");

    const unlockEpoch = event?.args?.unlockEpoch;

    // pass enough epochs so the burned position is fully unlocked
    for (let i = 0; i < 17; i++) {
      await incrementVlcvxEpoch();
    }

    tx = await votiumStrategy.withdraw(unlockEpoch);
    await tx.wait();

    const price3 = await votiumStrategy.price();

    expect(price0).eq(price1).eq(price2).eq(price3);
  });

  it("Should receive same cvx amount if withdrawing on the unlock epoch or after the unlock epoch", async function () {
    let tx = await votiumStrategy.mint({
      value: ethers.utils.parseEther("1"),
    });
    await tx.wait();

    tx = await votiumStrategy.requestWithdraw(
      await votiumStrategy.balanceOf(accounts[0].address)
    );
    const mined = await tx.wait();

    const event = mined?.events?.find((e) => e?.event === "WithdrawRequest");

    const unlockEpoch = event?.args?.unlockEpoch;

    // incremement to unlock epoch
    for (let i = 0; i < 17; i++) {
      const currentEpoch = await getCurrentEpoch();
      if (currentEpoch.eq(unlockEpoch)) break;
      await incrementVlcvxEpoch();
    }

    const ethBalanceBefore0 = await ethers.provider.getBalance(
      userAccount.address
    );

    tx = await votiumStrategy.withdraw(unlockEpoch);
    await tx.wait();

    const ethBalanceAfter0 = await ethers.provider.getBalance(
      userAccount.address
    );

    const ethReceived0 = ethBalanceAfter0.sub(ethBalanceBefore0);

    await resetToBlock(parseInt(process.env.BLOCK_NUMBER ?? "0"));

    tx = await votiumStrategy.mint({
      value: ethers.utils.parseEther("1"),
    });
    await tx.wait();

    tx = await votiumStrategy.requestWithdraw(
      await votiumStrategy.balanceOf(accounts[0].address)
    );
    await tx.wait();

    // increment way past unlock epoch
    for (let i = 0; i < 17 * 10; i++) {
      await incrementVlcvxEpoch();
    }

    const ethBalanceBefore1 = await ethers.provider.getBalance(
      userAccount.address
    );

    tx = await votiumStrategy.withdraw(unlockEpoch);
    await tx.wait();

    const ethBalanceAfter1 = await ethers.provider.getBalance(
      userAccount.address
    );

    const ethReceived1 = ethBalanceAfter1.sub(ethBalanceBefore1);

    expect(within1Pip(ethReceived0, ethReceived1)).eq(true);
  });

  it("Should allow owner to overide sell data and only sell some of the rewards instead of everything from the claim proof", async function () {
    const cvxTotalBefore = await votiumStrategy.cvxInSystem();
    const sellEventSmall = await oracleApplyRewards(
      rewarderAccount,
      votiumStrategy.address,
      await readJSONFromFile("./scripts/testDataSliced.json")
    );
    const cvxTotalAfter = await votiumStrategy.cvxInSystem();
    const totalCvxGain = cvxTotalAfter.sub(cvxTotalBefore);
    const eventCvx = sellEventSmall?.args?.cvxAmount;

    expect(totalCvxGain).eq(eventCvx);
    expect(totalCvxGain).gt(0);
  });

  it("Should fail to withdraw 1 epoch before the withdraw epoch and succeed on or after the withdraw epoch", async function () {
    let tx = await votiumStrategy.mint({
      value: ethers.utils.parseEther("1"),
    });
    await tx.wait();

    tx = await votiumStrategy.requestWithdraw(
      await votiumStrategy.balanceOf(accounts[0].address)
    );
    const mined = await tx.wait();

    const event = mined?.events?.find((e) => e?.event === "WithdrawRequest");

    const unlockEpoch = event?.args?.unlockEpoch;

    // incremement to unlock epoch minus 1
    for (let i = 0; i < 17; i++) {
      const currentEpoch = await getCurrentEpoch();
      if (currentEpoch.eq(unlockEpoch.sub(1))) break;
      await incrementVlcvxEpoch();
    }

    await expect(votiumStrategy.withdraw(unlockEpoch)).to.be.revertedWith(
      "Can't withdraw from future epoch"
    );

    await incrementVlcvxEpoch();
    const ethBalanceBefore1 = await ethers.provider.getBalance(
      userAccount.address
    );
    await votiumStrategy.withdraw(unlockEpoch);

    const ethBalanceAfter1 = await ethers.provider.getBalance(
      userAccount.address
    );

    const ethReceived1 = ethBalanceAfter1.sub(ethBalanceBefore1);

    expect(ethReceived1).gt(0);
  });

  it("Should fail to withdraw from the same epoch twice", async function () {
    let tx = await votiumStrategy.mint({
      value: ethers.utils.parseEther("1"),
    });
    await tx.wait();

    tx = await votiumStrategy.requestWithdraw(
      await votiumStrategy.balanceOf(accounts[0].address)
    );
    const mined = await tx.wait();

    const event = mined?.events?.find((e) => e?.event === "WithdrawRequest");

    const unlockEpoch = event?.args?.unlockEpoch;

    for (let i = 0; i < 17; i++) {
      const currentEpoch = await getCurrentEpoch();
      if (currentEpoch.eq(unlockEpoch)) break;
      await incrementVlcvxEpoch();
    }

    await incrementVlcvxEpoch();
    const ethBalanceBefore1 = await ethers.provider.getBalance(
      userAccount.address
    );
    tx = await votiumStrategy.withdraw(unlockEpoch);
    await tx.wait();
    const ethBalanceAfter1 = await ethers.provider.getBalance(
      userAccount.address
    );

    const ethReceived1 = ethBalanceAfter1.sub(ethBalanceBefore1);

    expect(ethReceived1).gt(0);

    await expect(votiumStrategy.withdraw(unlockEpoch)).to.be.revertedWith(
      "Nothing to withdraw"
    );
    await tx.wait();
  });

  it.only("Should THIS IS A PROBLEM!!!!! (transfer amount exceeds balance. this should not be failing)", async function () {
    let tx = await votiumStrategy.mint({
      value: ethers.utils.parseEther(".1"),
    });
    await tx.wait();

    await oracleApplyRewards(rewarderAccount, votiumStrategy.address);

    tx = await votiumStrategy.requestWithdraw(
      await votiumStrategy.balanceOf(accounts[0].address)
    );
    const mined = await tx.wait();

    const event = mined?.events?.find((e) => e?.event === "WithdrawRequest");

    const unlockEpoch = event?.args?.unlockEpoch;

    await incrementVlcvxEpoch();
    await incrementVlcvxEpoch();
    await incrementVlcvxEpoch();
    await incrementVlcvxEpoch();
    await incrementVlcvxEpoch();
    await oracleApplyRewards(rewarderAccount, votiumStrategy.address);

    // pass enough epochs so the burned position is fully unlocked
    for (let i = 0; i < 17; i++) {
      const currentEpoch = await getCurrentEpoch();
      if (currentEpoch.eq(unlockEpoch)) break;
      await incrementVlcvxEpoch();
    }

    const withdrawTx = await votiumStrategy.withdraw(unlockEpoch);
    const withdrawMined = await withdrawTx.wait();
    const withdrawEvent = withdrawMined?.events?.find((e) => e?.event === "Withdraw");
    console.log('withdrawEvent', withdrawEvent);
  });
});
