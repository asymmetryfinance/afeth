// import { ethers, network, upgrades } from "hardhat";
// import { AfEth, SafEthStrategy } from "../typechain-types";
// import { expect } from "chai";
// import { incrementEpochCallOracles } from "./strategies/Votium/VotiumTestHelpers";
// import { MULTI_SIG, RETH_DERIVATIVE, WST_DERIVATIVE } from "./constants";
// import { derivativeAbi } from "./abis/derivativeAbi";
// import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

// TODO fix for new erc20 afEth implementation
// describe.skip("Test AfEth (Votium + SafEth Strategies)", async function () {
  // let afEthManager: AfEth;
  // let safEthStrategy: SafEthStrategy;
  // let accounts: SignerWithAddress[];
  // before(async () => {
  //   accounts = await ethers.getSigners();

  //   const afEthFactory = await ethers.getContractFactory("AfEth");
  //   afEthManager = (await upgrades.deployProxy(afEthFactory)) as AfEth;
  //   await afEthManager.deployed();

  //   const votiumStrategyFactory = await ethers.getContractFactory(
  //     "VotiumStrategy"
  //   );
  //   votiumStrategy = (await upgrades.deployProxy(votiumStrategyFactory, [
  //     afEthManager.address,
  //   ])) as VotiumStrategy;
  //   await votiumStrategy.deployed();

  //   const safEthStrategyFactory = await ethers.getContractFactory(
  //     "SafEthStrategy"
  //   );
  //   safEthStrategy = (await upgrades.deployProxy(safEthStrategyFactory, [
  //     afEthManager.address,
  //   ])) as SafEthStrategy;
  //   await safEthStrategy.deployed();

  //   await afEthManager.addStrategy(safEthStrategy.address);
  //   await afEthManager.addStrategy(votiumStrategy.address);

  //   await network.provider.request({
  //     method: "hardhat_impersonateAccount",
  //     params: [MULTI_SIG],
  //   });

  //   const chainLinkRethFeedFactory = await ethers.getContractFactory(
  //     "ChainLinkRethFeedMock"
  //   );
  //   const chainLinkRethFeed = await chainLinkRethFeedFactory.deploy();

  //   const chainLinkWstFeedFactory = await ethers.getContractFactory(
  //     "ChainLinkWstFeedMock"
  //   );
  //   const chainLinkWstFeed = await chainLinkWstFeedFactory.deploy();

  //   const multiSigSigner = await ethers.getSigner(MULTI_SIG);

  //   // mock chainlink feed on derivatives
  //   const rEthDerivative = new ethers.Contract(
  //     RETH_DERIVATIVE,
  //     derivativeAbi,
  //     accounts[0]
  //   );
  //   const multiSigReth = rEthDerivative.connect(multiSigSigner);
  //   await multiSigReth.setChainlinkFeed(chainLinkRethFeed.address);

  //   const wstEthDerivative = new ethers.Contract(
  //     WST_DERIVATIVE,
  //     derivativeAbi,
  //     accounts[0]
  //   );
  //   const multiSigWst = wstEthDerivative.connect(multiSigSigner);
  //   await multiSigWst.setChainlinkFeed(chainLinkWstFeed.address);
  // });
  // it("Should mint with uneven ratios", async function () {
  //   // verify strategy positions
  //   let votiumPosition = await votiumStrategy.vlCvxPositions(1);
  //   let safEthPosition = await safEthStrategy.safEthPositions(1);
  //   let tokenCount = await afEthManager.tokenCount();

  //   expect(votiumPosition.cvxAmount).eq(0);
  //   expect(safEthPosition).eq(0);
  //   expect(tokenCount).eq(0);
  //   await afEthManager.mint(
  //     [ethers.utils.parseEther(".3"), ethers.utils.parseEther(".7")],
  //     { value: ethers.utils.parseEther("1") }
  //   );
  //   votiumPosition = await votiumStrategy.vlCvxPositions(1);
  //   safEthPosition = await safEthStrategy.safEthPositions(1);
  //   tokenCount = await afEthManager.tokenCount();

  //   expect(votiumPosition.cvxAmount).eq("402121500509689836997");
  //   expect(safEthPosition).eq("297549090148980303");
  //   expect(tokenCount).eq(1);

  //   // verify nft position
  //   const ownerAddress = await ethers.provider.getSigner(0).getAddress();
  //   const nftOwner = await afEthManager.ownerOf(1);
  //   expect(nftOwner).eq(ownerAddress);
  //   const nftBalance = await afEthManager.balanceOf(ownerAddress);
  //   expect(nftBalance).eq(1);
  // });
  // it("Should mint with even ratios", async function () {
  //   // verify strategy positions
  //   let vlCvxPosition = await votiumStrategy.vlCvxPositions(2);
  //   let safEthPosition = await safEthStrategy.safEthPositions(2);
  //   let tokenCount = await afEthManager.tokenCount();

  //   expect(vlCvxPosition.cvxAmount).eq(0);
  //   expect(safEthPosition).eq(0);
  //   expect(tokenCount).eq(1);
  //   await afEthManager.mint(
  //     [ethers.utils.parseEther(".5"), ethers.utils.parseEther(".5")],
  //     { value: ethers.utils.parseEther("1") }
  //   );
  //   vlCvxPosition = await votiumStrategy.vlCvxPositions(2);
  //   safEthPosition = await safEthStrategy.safEthPositions(2);
  //   tokenCount = await afEthManager.tokenCount();

  //   expect(vlCvxPosition.cvxAmount).eq("287145334757983898510");
  //   expect(safEthPosition).eq("495915150248300505");
  //   expect(tokenCount).eq(2);
  // });
  // it("Should fail to mint with wrong ratios", async function () {
  //   await expect(
  //     afEthManager.mint(
  //       [ethers.utils.parseEther(".51"), ethers.utils.parseEther(".5")],
  //       { value: ethers.utils.parseEther("1") }
  //     )
  //   ).to.be.revertedWith("InvalidRatio");
  // });
  // it("Should request to close positions", async function () {
  //   let vPosition = await votiumStrategy.positions(1);
  //   let sPosition = await safEthStrategy.positions(1);
  //   expect(vPosition.unlockTime).eq("0");
  //   expect(sPosition.unlockTime).eq("0");
  //   await afEthManager.requestClose(1);
  //   vPosition = await votiumStrategy.positions(1);
  //   sPosition = await safEthStrategy.positions(1);
  //   expect(vPosition.unlockTime).eq("1701302400");
  //   expect(sPosition.unlockTime).eq("1691620468");
  // });
  // it("Can't request to close positions if already closed", async function () {
  //   await expect(afEthManager.requestClose(1)).to.be.revertedWith(
  //     "Already requested close"
  //   );
  // });
  // it("Can't request to close positions if not the owner", async function () {
  //   const notOwner = afEthManager.connect(accounts[1]);
  //   await expect(notOwner.requestClose(2)).to.be.revertedWith("Not owner");
  // });
  // it("Can't request burn positions if not the owner", async function () {
  //   const notOwner = afEthManager.connect(accounts[1]);
  //   await expect(notOwner.burn(1)).to.be.revertedWith("Not owner");
  // });
  // it("Can't burn positions if not requested to close", async function () {
  //   await expect(afEthManager.burn(1)).to.be.revertedWith("still locked");
  // });
  // it("Should burn positions", async function () {
  //   let vPosition = await votiumStrategy.positions(1);
  //   let sPosition = await safEthStrategy.positions(1);
  //   expect(vPosition.unlockTime).eq("1701302400");
  //   expect(vPosition.ethBurned).eq("0");
  //   expect(sPosition.unlockTime).eq("1691620468");
  //   expect(sPosition.ethBurned).eq("0");
  //   for (let i = 0; i < 17; i++) {
  //     await incrementEpochCallOracles(votiumStrategy);
  //   }
  //   await afEthManager.burn(1);
  //   vPosition = await votiumStrategy.positions(1);
  //   sPosition = await safEthStrategy.positions(1);
  //   expect(vPosition.ethBurned).eq("696443599046152185");
  //   expect(sPosition.ethBurned).eq("300006572996331905");
  // });
  // it("Should claim all rewards", async function () {
  //   // TODO
  // });
// });
