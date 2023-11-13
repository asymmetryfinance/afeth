import { ethers, upgrades } from "hardhat";

async function main() {
  //   const AfEthFactory = await ethers.getContractFactory("AfEth");
  //   const afEth = await AfEthFactory.deploy();
  //   await afEth.deployed();

  //   console.log("AfEth deployed to:", afEth.address);

  const VotiumStrategyFactory = await ethers.getContractFactory(
    "VotiumStrategy"
  );

  const votiumStrategy = await upgrades.deployProxy(VotiumStrategyFactory, [
    ethers.constants.AddressZero,
    ethers.constants.AddressZero,
    ethers.constants.AddressZero,
  ]);
  console.log("votiumStrategy deployed to:", votiumStrategy.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
