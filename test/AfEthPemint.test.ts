import { AfEth, VotiumStrategy } from "../typechain-types";
import { ethers, network, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { MULTI_SIG, RETH_DERIVATIVE, WST_DERIVATIVE } from "./constants";
import { expect } from "chai";
import { derivativeAbi } from "./abis/derivativeAbi";
import { nowPlusOneMinute } from "./AfEth.test";
import { within1Pip, withinQuarterPercent } from "./helpers/helpers";
import { incrementVlcvxEpoch } from "./strategies/Votium/VotiumTestHelpers";
import { BigNumber } from "ethers/lib/ethers";

describe("Test AfEth Premint Functionality", async function () {
  let afEth: AfEth;
  let votiumStrategy: VotiumStrategy;
  let accounts: SignerWithAddress[];

  const initialStake = ethers.utils.parseEther(".1");
  const initialStakeAccount = 11;

  beforeEach(async () => {
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.MAINNET_URL,
            blockNumber: parseInt(process.env.BLOCK_NUMBER ?? "0"),
          },
        },
      ],
    });
    accounts = await ethers.getSigners();
    const afEthFactory = await ethers.getContractFactory("AfEth");
    afEth = (await upgrades.deployProxy(afEthFactory, [])) as AfEth;
    await afEth.deployed();
    const votiumFactory = await ethers.getContractFactory("VotiumStrategy");
    votiumStrategy = (await upgrades.deployProxy(votiumFactory, [
      accounts[0].address,
      accounts[0].address,
      afEth.address,
    ])) as VotiumStrategy;
    await votiumStrategy.deployed();

    await afEth.setStrategyAddress(votiumStrategy.address);
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
    const tx = await afEth
      .connect(accounts[initialStakeAccount])
      .deposit(0, await nowPlusOneMinute(), {
        value: initialStake,
      });
    await tx.wait();

    const chainLinkCvxEthFeedFactory = await ethers.getContractFactory(
      "ChainLinkCvxEthFeedMock"
    );
    const chainLinkCvxEthFeed = await chainLinkCvxEthFeedFactory.deploy();
    await chainLinkCvxEthFeed.deployed();
    await votiumStrategy.setChainlinkCvxEthFeed(chainLinkCvxEthFeed.address);
    await afEth.setRewarderAddress(accounts[0].address);

    const tx2 = await afEth.setPremintMaxAmounts(
      ethers.utils.parseEther("100"),
      ethers.utils.parseEther("100")
    );
    await tx2.wait();

    const tx3 = await afEth.premintSetFees(
      ethers.utils.parseEther("0.2"),
      ethers.utils.parseEther("0.5")
    );
    await tx3.wait();
  });

  it("Should allow owner to call premintOwnerDeposit() and premintOwnerWithdraw() with eth and afEth and fail if trying to withdraw too much or non owner call", async function () {
    let tx;

    // get some afEth to put in the preminter
    tx = await afEth.deposit(0, await nowPlusOneMinute(), {
      value: ethers.utils.parseEther("10"),
    });
    await tx.wait();

    const ethDepositAmount = ethers.utils.parseEther("4.20");
    const afEthDepositAmount = ethers.utils.parseEther("6.9");

    tx = await afEth.premintDeposit(afEthDepositAmount, {
      value: ethDepositAmount,
    });
    await tx.wait();

    const afethTrueBalance = await afEth.balanceOf(afEth.address);
    const afEthPremintBalance = await afEth.preminterAfEthBalance();

    const ethTrueBalance = await ethers.provider.getBalance(afEth.address);
    const ethPremintBalance = await afEth.preminterEthBalance();

    expect(ethDepositAmount).eq(ethTrueBalance).eq(ethPremintBalance);
    expect(afEthDepositAmount).eq(afethTrueBalance).eq(afEthPremintBalance);

    tx = await afEth.premintWithdraw(
      ethers.utils.parseEther("1"),
      ethers.utils.parseEther("2")
    );
    await tx.wait();

    const afethTrueBalanceAfter = await afEth.balanceOf(afEth.address);
    const afEthPremintBalanceAfter = await afEth.preminterAfEthBalance();
    const ethTrueBalanceAfter = await ethers.provider.getBalance(afEth.address);
    const ethPremintBalanceAfter = await afEth.preminterEthBalance();

    expect(ethDepositAmount.sub(ethers.utils.parseEther("1")))
      .eq(ethTrueBalanceAfter)
      .eq(ethPremintBalanceAfter);
    expect(afEthDepositAmount.sub(ethers.utils.parseEther("2")))
      .eq(afethTrueBalanceAfter)
      .eq(afEthPremintBalanceAfter);

    // expect revert if withdrawing too much of either asset
    await expect(
      afEth.premintWithdraw(
        ethTrueBalanceAfter.add(ethers.utils.parseEther("1")),
        ethers.utils.parseEther("0")
      )
    ).to.be.revertedWith("InsufficientBalance()");
    await expect(
      afEth.premintWithdraw(
        ethers.utils.parseEther("0"),
        afethTrueBalanceAfter.add(ethers.utils.parseEther("1"))
      )
    ).to.be.revertedWith("InsufficientBalance()");

    // withdraw all
    tx = await afEth.premintWithdraw(
      ethPremintBalanceAfter,
      afEthPremintBalanceAfter
    );

    const afEthTrueBalanceFinal = await afEth.balanceOf(afEth.address);
    const afEthPremintBalanceFinal = await afEth.preminterAfEthBalance();
    const ethTrueBalanceFinal = await ethers.provider.getBalance(afEth.address);
    const ethPremintBalanceFinal = await afEth.preminterEthBalance();

    expect(afEthTrueBalanceFinal).eq(afEthPremintBalanceFinal).eq(0);
    expect(ethTrueBalanceFinal).eq(ethPremintBalanceFinal).eq(0);

    const afEthNonOwner = afEth.connect(accounts[1]);

    await expect(
      afEthNonOwner.premintWithdraw(
        ethers.utils.parseEther("1"),
        ethers.utils.parseEther("1")
      )
    ).to.be.revertedWith("Ownable: caller is not the owner");
    await expect(
      afEthNonOwner.premintDeposit(ethers.utils.parseEther("1"))
    ).to.be.revertedWith("Ownable: caller is not the owner");
  });

  it("Should allow owner to call premintSetFees() and setPremintMaxAmounts() and fail if non owner", async function () {
    let tx;
    tx = await afEth.premintSetFees(
      ethers.utils.parseEther("0.420"),
      ethers.utils.parseEther("0.69")
    );
    await tx.wait();

    const minFee = await afEth.preminterMinFee();
    const maxFee = await afEth.preminterMaxFee();

    expect(minFee).eq(ethers.utils.parseEther("0.420"));
    expect(maxFee).eq(ethers.utils.parseEther("0.69"));

    tx = await afEth.setPremintMaxAmounts(
      ethers.utils.parseEther("100"),
      ethers.utils.parseEther("100")
    );
    await tx.wait();

    const afEthNonOwner = afEth.connect(accounts[1]);

    expect(
      afEthNonOwner.setPremintMaxAmounts(
        ethers.utils.parseEther("100"),
        ethers.utils.parseEther("100")
      )
    ).to.be.revertedWith("Ownable: caller is not the owner");

    await expect(
      afEthNonOwner.premintSetFees(
        ethers.utils.parseEther("0.420"),
        ethers.utils.parseEther("0.69")
      )
    ).to.be.revertedWith("Ownable: caller is not the owner");
  });

  it("Should show premintBuy() returns similar amount to deposit() and checks minout and max buy amount", async function () {
    let tx;

    // get some afEth to put in the preminter
    tx = await afEth.deposit(0, await nowPlusOneMinute(), {
      value: ethers.utils.parseEther("10"),
    });
    await tx.wait();

    const ethDepositAmount = ethers.utils.parseEther("5");
    const afEthDepositAmount = ethers.utils.parseEther("5");

    tx = await afEth.premintDeposit(afEthDepositAmount, {
      value: ethDepositAmount,
    });
    await tx.wait();

    const afEthNonOwner1 = afEth.connect(accounts[1]);
    const afEthNonOwner2 = afEth.connect(accounts[2]);

    tx = await afEthNonOwner1.premintBuy(0, {
      value: ethers.utils.parseEther("4"),
    });
    await tx.wait();

    tx = await afEthNonOwner2.deposit(0, await nowPlusOneMinute(), {
      value: ethers.utils.parseEther("4"),
    });

    const afEthBalance1 = await afEth.balanceOf(accounts[1].address);
    const afEthBalance2 = await afEth.balanceOf(accounts[2].address);

    expect(withinQuarterPercent(afEthBalance1, afEthBalance2)).eq(true);

    await expect(
      afEthNonOwner1.premintBuy(0, {
        value: ethers.utils.parseEther("101"),
      })
    ).to.be.revertedWith("PreminterMaxBuy()");

    await expect(
      afEthNonOwner1.premintBuy(ethers.utils.parseEther("999"), {
        value: ethers.utils.parseEther("4"),
      })
    ).to.be.revertedWith("PreminterMinout()");
  });

  it("Should show premintSell() returning correct values for max time", async function () {
    let tx;

    tx = await afEth.premintSetFees(
      ethers.utils.parseEther("0.1"),
      ethers.utils.parseEther("0.2")
    );
    await tx.wait();

    const preminterMinFee = await afEth.preminterMinFee();
    const preminterMaxFee = await afEth.preminterMaxFee();
    // get some afEth to put in the preminter
    tx = await afEth.deposit(0, await nowPlusOneMinute(), {
      value: ethers.utils.parseEther("25"),
    });
    await tx.wait();

    const premintEthDepositAmount = ethers.utils.parseEther("20");
    const premintAfEthDepositAmount = ethers.utils.parseEther("20");
    tx = await afEth.premintDeposit(premintAfEthDepositAmount, {
      value: premintEthDepositAmount,
    });
    await tx.wait();
    const ethDepositAmount = ethers.utils.parseEther("1");

    const afEthBalanceBeforeBuy1 = await afEth.balanceOf(accounts[1].address);
    const premintUser = afEth.connect(accounts[1]);
    tx = await premintUser.premintBuy(0, {
      value: ethDepositAmount,
    });
    await tx.wait();
    const afEthBalanceAfterBuy1 = await afEth.balanceOf(accounts[1].address);
    const afEthMinted1 = afEthBalanceAfterBuy1.sub(afEthBalanceBeforeBuy1);

    const expectedFeePercent1 = await afEth.premintSellFeePercent(
      ethers.utils.parseEther("1")
    );

    // fee is somewhere between min and max
    expect(preminterMinFee).lte(expectedFeePercent1).lte(preminterMaxFee);

    // fee is very close to max because we didnt wait any time
    const expectedSell1EthReceived = BigNumber.from("1000000000000000000")
      .sub(preminterMaxFee.toString())
      .mul(ethDepositAmount.toString())
      .div("1000000000000000000");

    const ethBalanceBeforeSell1 = await ethers.provider.getBalance(
      accounts[1].address
    );

    tx = await premintUser.premintSell(afEthMinted1, 0);
    await tx.wait();
    const ethBalanceAfterSell1 = await ethers.provider.getBalance(
      accounts[1].address
    );

    const sell1EthReceived = ethBalanceAfterSell1.sub(ethBalanceBeforeSell1);

    expect(withinQuarterPercent(sell1EthReceived, expectedSell1EthReceived)).eq(
      true
    );
  });

  const withdrawTimeRemaining = async (afEthAmont: BigNumber) => {
    const currentBlock = await ethers.provider.getBlock("latest");
    const currentBlockTime = currentBlock.timestamp;
    return (await afEth.withdrawTime(afEthAmont)).sub(currentBlockTime);
  };

  const expectedFeePercent = async (afEthToSell: BigNumber) => {
    const maxFeeTime = BigNumber.from(24 * 60 * 60 * 7 * 17); // 17 weeks out is when max fee applies
    const minFeeTime = BigNumber.from(24 * 60 * 60 * 7 * 2); // 2 weeks or less is when min fee applies
    const feeTimeDiff = maxFeeTime.sub(minFeeTime);

    const preminterMaxFee = await afEth.preminterMaxFee();
    const preminterMinFee = await afEth.preminterMinFee();

    const feeDiff = preminterMaxFee.sub(preminterMinFee);

    // how long until they could normally unstake
    const timeRemaining = await withdrawTimeRemaining(afEthToSell);

    if (timeRemaining.lt(minFeeTime)) return preminterMinFee;
    const timeRemainingAboveMinFeeTime = timeRemaining.sub(minFeeTime);
    const feeTimeDiffPercentComplete = timeRemainingAboveMinFeeTime
      .mul("1000000000000000000")
      .div(feeTimeDiff);
    return preminterMinFee.add(
      feeDiff.mul(feeTimeDiffPercentComplete).div("1000000000000000000")
    );
  };

  const expectedPremintSellResult = async (afEthWithdrawAmount: BigNumber) => {
    const expectedFeePercentage = await expectedFeePercent(afEthWithdrawAmount);

    // 1 afEth should equal 1 eth because prices havent changed yet
    const ethReceivedBeforeFee = afEthWithdrawAmount;

    // eslint-disable-next-line prettier/prettier
    const ethReceivedAfterFee = BigNumber.from("1000000000000000000")
      // eslint-disable-next-line prettier/prettier
      .sub(expectedFeePercentage)
      .mul(ethReceivedBeforeFee)
      .div("1000000000000000000");
    return ethReceivedAfterFee;
  };

  it("Should test premintSellFeePercent(), premintSellAmount() and premintSell() for various unlock times", async function () {
    // get some afEth to put in the preminter
    let tx = await afEth.deposit(0, await nowPlusOneMinute(), {
      value: ethers.utils.parseEther("5"),
    });
    await tx.wait();

    tx = await afEth.premintDeposit(ethers.utils.parseEther("2"), {
      value: ethers.utils.parseEther("2"),
    });
    await tx.wait();

    const trackedvStrategyBalance = await afEth.trackedvStrategyBalance();
    const afEthTotalSupply = await afEth.totalSupply();
    const vStrategyWithdrawAmount = trackedvStrategyBalance.div(40);
    const afEthWithdrawAmount = afEthTotalSupply.div(40);

    let lastEthReceived = BigNumber.from("0");

    // go for more than 15 epochs to show fees dont go any lower after 15
    for (let i = 0; i < 20; i++) {
      const feePercent = await afEth.premintSellFeePercent(
        vStrategyWithdrawAmount
      );
      const expectedEthReceivedFromPremint = await afEth.premintSellAmount(
        afEthWithdrawAmount
      );
      const ethBalanceBeforeSell1 = await ethers.provider.getBalance(
        accounts[0].address
      );

      tx = await afEth.premintSell(afEthWithdrawAmount, 0);
      const mined = await tx.wait();
      const ethBalanceAfterSell1 = await ethers.provider.getBalance(
        accounts[0].address
      );
      const txFee = mined.gasUsed.mul(mined.effectiveGasPrice);
      const ethReceived = ethBalanceAfterSell1
        .sub(ethBalanceBeforeSell1)
        .add(txFee);

      expect(within1Pip(ethReceived, expectedEthReceivedFromPremint)).eq(true);
      const expectedFeePercentage = await expectedFeePercent(
        afEthWithdrawAmount
      );

      expect(withinQuarterPercent(feePercent, expectedFeePercentage)).eq(true);
      const expectedEthReceivedFromPremintSell =
        await expectedPremintSellResult(afEthWithdrawAmount);
      expect(
        withinQuarterPercent(
          expectedEthReceivedFromPremint,
          expectedEthReceivedFromPremintSell
        )
      ).eq(true);
      await incrementVlcvxEpoch();

      // for the last 2 epochs fees dont go down any more
      if (i > 15) expect(lastEthReceived.eq(ethReceived)).eq(true);
      lastEthReceived = ethReceived;
    }
  });

  it("Should fail to premintSell() and premintBuy() if insufficient balances", async function () {
    // get some afEth to put in the preminter
    let tx = await afEth.deposit(0, await nowPlusOneMinute(), {
      value: ethers.utils.parseEther("2"),
    });
    await tx.wait();

    tx = await afEth.premintDeposit(ethers.utils.parseEther("1"), {
      value: ethers.utils.parseEther("1"),
    });
    await tx.wait();

    expect(
      afEth.premintBuy(0, { value: ethers.utils.parseEther("2") })
    ).to.be.revertedWith("InsufficientBalance()");
    expect(
      afEth.premintSell(ethers.utils.parseEther("2"), 0)
    ).to.be.revertedWith("InsufficientBalance()");
  });
});
