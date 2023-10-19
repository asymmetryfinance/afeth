import { ethers } from "hardhat";

async function main() {
  const AfEthFactory = await ethers.getContractFactory("AfEth");
  const afEth = await AfEthFactory.deploy();
  await afEth.deployed();

  console.log("AfEth deployed to:", afEth.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });