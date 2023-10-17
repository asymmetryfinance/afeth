import { ethers, upgrades } from "hardhat";

async function main() {
  const AfEthFactory = await ethers.getContractFactory("AfEth");
  const MULTI_SIG = "0x263b03BbA0BbbC320928B6026f5eAAFAD9F1ddeb";
  const afEth = await upgrades.deployProxy(AfEthFactory, []);
  await afEth.deployed();

  console.log("AfEth deployed to:", afEth.address);

  const VotiumFactory = await ethers.getContractFactory("VotiumStrategy");
  const votium = await upgrades.deployProxy(VotiumFactory, [
    MULTI_SIG,
    MULTI_SIG,
    afEth.address,
  ]);
  await votium.deployed();

  console.log("Votium deployed to:", votium.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
