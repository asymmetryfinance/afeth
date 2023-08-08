import { ethers, upgrades } from "hardhat";
import { AfEth, SafEthStrategy, VotiumStrategy } from "../typechain-types";
import { expect } from "chai";

describe("Test AfEth (Votium + SafEth Strategies)", async function () {
  let afEthManager: AfEth;
  let votiumStrategy: VotiumStrategy;
  let safEthStrategy: SafEthStrategy;

  before(async () => {
    const afEthFactory = await ethers.getContractFactory("AfEth");
    afEthManager = (await upgrades.deployProxy(afEthFactory)) as AfEth;
    await afEthManager.deployed();

    const votiumStrategyFactory = await ethers.getContractFactory(
      "VotiumStrategy"
    );
    votiumStrategy = (await upgrades.deployProxy(votiumStrategyFactory, [
      afEthManager.address,
    ])) as VotiumStrategy;
    await votiumStrategy.deployed();

    const safEthStrategyFactory = await ethers.getContractFactory(
      "SafEthStrategy"
    );
    safEthStrategy = (await upgrades.deployProxy(safEthStrategyFactory, [
      afEthManager.address,
    ])) as SafEthStrategy;
    await safEthStrategy.deployed();

    await afEthManager.addStrategy(votiumStrategy.address);
    await afEthManager.addStrategy(safEthStrategy.address);
  });
  it("Should mint with uneven ratios", async function () {
    // verify strategy positions
    let votiumPosition = await votiumStrategy.vlCvxPositions(1);
    let safEthPosition = await safEthStrategy.safEthPositions(1);
    let tokenCount = await afEthManager.tokenCount();

    expect(votiumPosition.cvxAmount).eq(0);
    expect(safEthPosition).eq(0);
    expect(tokenCount).eq(0);
    await afEthManager.mint(
      [ethers.utils.parseEther(".3"), ethers.utils.parseEther(".7")],
      { value: ethers.utils.parseEther("1") }
    );
    votiumPosition = await votiumStrategy.vlCvxPositions(1);
    safEthPosition = await safEthStrategy.safEthPositions(1);
    tokenCount = await afEthManager.tokenCount();

    expect(votiumPosition.cvxAmount).eq("185590451737888536751");
    expect(safEthPosition).eq("699649515058320520");
    expect(tokenCount).eq(1);

    // verify nft position
    const ownerAddress = await ethers.provider.getSigner(0).getAddress();
    const nftOwner = await afEthManager.ownerOf(1);
    expect(nftOwner).eq(ownerAddress);
    const nftBalance = await afEthManager.balanceOf(ownerAddress);
    expect(nftBalance).eq(1);
  });
  it("Should mint with even ratios", async function () {
    // verify strategy positions
    let votiumPosition = await votiumStrategy.vlCvxPositions(2);
    let safEthPosition = await safEthStrategy.safEthPositions(2);
    let tokenCount = await afEthManager.tokenCount();

    expect(votiumPosition.cvxAmount).eq(0);
    expect(safEthPosition).eq(0);
    expect(tokenCount).eq(1);
    await afEthManager.mint(
      [ethers.utils.parseEther(".5"), ethers.utils.parseEther(".5")],
      { value: ethers.utils.parseEther("1") }
    );
    votiumPosition = await votiumStrategy.vlCvxPositions(2);
    safEthPosition = await safEthStrategy.safEthPositions(2);
    tokenCount = await afEthManager.tokenCount();

    expect(votiumPosition.cvxAmount).eq("309264117388178050890");
    expect(safEthPosition).eq("499747505426046777");
    expect(tokenCount).eq(2);
  });
  it("Should fail to mint with wrong ratios", async function () {
    await expect(
      afEthManager.mint(
        [ethers.utils.parseEther(".51"), ethers.utils.parseEther(".5")],
        { value: ethers.utils.parseEther("1") }
      )
    ).to.be.revertedWith("InvalidRatio");
  });
  it("Should request to close positions", async function () {
    // TODO
  });
  it("Can't request to close positions if not the owner", async function () {
    // TODO
  });
  it("Should burn positions", async function () {
    // TODO
  });
  it("Can't request burn positions if not the owner", async function () {
    // TODO
  });
  it("Should claim all rewards", async function () {
    // TODO
  });
});
