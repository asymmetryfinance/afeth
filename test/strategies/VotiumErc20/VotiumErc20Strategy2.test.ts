import { network, ethers, upgrades } from "hardhat";
import { VotiumErc20Strategy } from "../../../typechain-types";
import { expect } from "chai";
import {
  getCurrentEpoch,
  incrementVlcvxEpoch,
  oracleApplyRewards,
  readJSONFromFile,
  updateRewardsMerkleRoot,
} from "./VotiumTestHelpers";
import { within1Pip } from "../../helpers/helpers";
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
  it.only("Should be able to sell & apply a large proportion of the total rewards with minimal slippage", async function () {
    let tx = await votiumStrategy.mint({
      value: ethers.utils.parseEther("1"),
    });
    await tx.wait();

    const underlyingCvx0 = await votiumStrategy.cvxInSystem();

    console.log('underlyingCvx0', ethers.utils.formatEther(underlyingCvx0).toString());
    // merkle proof with large claim amount (12.5% of each reward token)
    const slippageTestDataSmall = await readJSONFromFile(
      "./scripts/testDataSlippage.json"
    );

    console.log('about to apply rewards');
    const sellEvent = await oracleApplyRewards(
      rewarderAccount,
      votiumStrategy.address,
      slippageTestDataSmall
    );

    console.log('sellEvent is', sellEvent);

    // const ethReceivedFromRewards = sellEvent?.args?.ethAmount;
    // const cvxReceivedFromRewards = sellEvent?.args?.cvxAmount;
    // console.log(
    //   "ethReceivedFromRewards is",
    //   ethers.utils.formatEther(ethReceivedFromRewards)
    // );
    // console.log(
    //   "cvxReceivedFromRewards is",
    //   ethers.utils.formatEther(cvxReceivedFromRewards)
    // );

    // console.log('sellEvent is', sellEvent)

    // const cvxGained0 = (await votiumStrategy.cvxInSystem()).sub(underlyingCvx0);

    // console.log("cvxGained0", ethers.utils.formatEther(cvxGained0).toString());
    // await resetToBlock(parseInt(process.env.BLOCK_NUMBER ?? "0"))

    // tx = await votiumStrategy.requestWithdraw(
    //   await votiumStrategy.balanceOf(userAccount.address)
    // );
    // const mined1 = await tx.wait();
    // const event = mined1?.events?.find((e) => e?.event === "WithdrawRequest");
    // const unlockEpoch = event?.args?.unlockEpoch;
    // const currentEpoch = await getCurrentEpoch();
    // const epochsUntilUnlock = unlockEpoch.sub(currentEpoch);

    // for (let i = 0; i < epochsUntilUnlock; i++) {
    //   await incrementVlcvxEpoch();
    // }

    // const ethBalanceBefore = await ethers.provider.getBalance(
    //   userAccount.address
    // );

    // tx = await votiumStrategy.withdraw(unlockEpoch);
    // await tx.wait();

    // const ethBalanceAfter = await ethers.provider.getBalance(
    //   userAccount.address
    // );

    // const ethReceived = ethBalanceAfter.sub(ethBalanceBefore);

    // console.log("ethReceived", ethers.utils.formatEther(ethReceived));
  });
  it("Should test everything about the queue to be sure it works correctly", async function () {
    // TODO
  });
  it("Should allow owner to manually deposit eth rewards and price goes up", async function () {
    // TODO
  });
  it("Should not change the price when minting, burning or withdrawing", async function () {
    // TODO
  });
  it("Should allow owner to overide sell data and only sell some of the rewards instead of everything from the claim proof", async function () {
    // TODO
  });
});
