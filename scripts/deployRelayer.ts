import { ethers, upgrades } from "hardhat";

async function main() {
  const AfEthFactory = await ethers.getContractFactory("AfEthRelayer");
  const afEth = await upgrades.deployProxy(AfEthFactory, []);
  await afEth.deployed();

  console.log("AfEthRelayer deployed to:", afEth.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
