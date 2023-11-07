import { AfEth, VotiumStrategy } from "../typechain-types";
import { ethers, network, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { MULTI_SIG, RETH_DERIVATIVE, WST_DERIVATIVE } from "./constants";
import { expect } from "chai";
import { derivativeAbi } from "./abis/derivativeAbi";
import { nowPlusOneMinute } from "./AfEth.test";

describe.only("Test AfEth Premint Functionality", async function () {
  let afEth: AfEth;
  let votiumStrategy: VotiumStrategy;
  let accounts: SignerWithAddress[];

  const initialStake = ethers.utils.parseEther(".1");
  const initialStakeAccount = 11;

  before(async () => {
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
  });

  it("Should allow owner to call premintOwnerDeposit() and premintOwnerWithdraw() with eth and afEth", async function () {
    let tx;

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
  });
});
