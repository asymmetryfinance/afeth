import { network, ethers, upgrades } from "hardhat";
import { VotiumErc20Strategy } from "../../../typechain-types";
import { expect } from "chai";
import {
  getCurrentEpoch,
  incrementVlcvxEpoch,
  readJSONFromFile,
  updateRewardsMerkleRoot,
} from "./VotiumTestHelpers";
import {
  votiumClaimRewards,
  votiumSellRewards,
} from "../../../scripts/applyVotiumRewardsHelpers";
import { within1Pip } from "../../helpers/helpers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

describe.only("Test VotiumErc20Strategy (Part 2)", async function () {
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
      value: ethers.utils.parseEther("1"),
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
    await oracleApplyRewards(rewarderAccount);
    // this should throw
    try {
      await oracleApplyRewards(userAccount);
    } catch (e: any) {
      expect(e.message).eq(
        "VM Exception while processing transaction: reverted with reason string 'not rewarder'"
      );
    }
  });
  it("Should not be able to requestWithdraw() for more than a users balance", async function () {
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
  it("Should decrease users balance when requestWithdraw() is called", async function () {
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
  it("Should be able to sell & apply millions of dollars in rewards with minimal slippage", async function () {
    const tx = await votiumStrategy.mint({
      value: ethers.utils.parseEther("1"),
    });
    await tx.wait();

    // TODO show that selling small amount of rewards has same slippage as large amount

    // const expectedStrategyContractAddress =
    //   "0x38628490c3043E5D0bbB26d5a0a62fC77342e9d5";

    // const recipients = [
    //   expectedStrategyContractAddress,
    //   "0x8a65ac0E23F31979db06Ec62Af62b132a6dF4741",
    //   "0x0000462df2438f7b39577917374b1565c306b908",
    //   "0x000051d46ff97559ed5512ac9d2d95d0ef1140e1",
    //   "0xc90c5cc170a8db4c1b66939e1a0bb9ad47c93602",
    //   "0x47CB53752e5dc0A972440dA127DCA9FBA6C2Ab6F",
    //   "0xe7ebef64f1ff602a28d8d37049e46d0ca77a38ac",
    //   "0x76a1f47f8d998d07a15189a07d9aada180e09ac6",
    // ];

    // // give each user 1/10th of whats there for each token.
    // const divisibility = BigNumber.from(10);

    // const testData = await generateMockProofsAndSwaps(
    //   recipients,
    //   expectedStrategyContractAddress,
    //   divisibility
    // );

    // await updateRewardsMerkleRoot(
    //   testData.merkleRoots,
    //   testData.swapsData.map((sd: any) => sd.sellToken)
    // );

    // await votiumClaimRewards(
    //   rewarderAccount,
    //   votiumStrategy.address,
    //   testData.claimProofs
    // );

    // await votiumSellRewards(
    //   rewarderAccount,
    //   votiumStrategy.address,
    //   [],
    //   testData.swapsData
    // );
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

  const oracleApplyRewards = async (account: SignerWithAddress) => {
    const testData = await readJSONFromFile("./scripts/testData.json");
    await updateRewardsMerkleRoot(
      testData.merkleRoots,
      testData.swapsData.map((sd: any) => sd.sellToken)
    );
    await votiumClaimRewards(
      account,
      votiumStrategy.address,
      testData.claimProofs
    );
    await votiumSellRewards(
      account,
      votiumStrategy.address,
      [],
      testData.swapsData
    );
  };
});
