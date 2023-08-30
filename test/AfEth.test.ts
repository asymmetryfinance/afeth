import { AfEth } from "../typechain-types";
import { ethers, network, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

describe("Test AfEth", async function () {
  let afEth: AfEth;
  let accounts: SignerWithAddress[];

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
    const afEthFactory = await ethers.getContractFactory("AfEth");
    afEth = (await upgrades.deployProxy(afEthFactory, [])) as AfEth;
    await afEth.deployed();
    // mint some to seed the system so totalSupply is never 0 (prevent price weirdness on withdraw)
    const tx = await afEth.connect(accounts[11]).deposit({
      value: ethers.utils.parseEther(".000001"),
    });
    await tx.wait();
  };

  beforeEach(
    async () => await resetToBlock(parseInt(process.env.BLOCK_NUMBER ?? "0"))
  );
  it("Should mint, requestwithdraw, withdraw the safEth portion now, wait until votium can be withdrawn and withdraw again", async function () {
    const depositAmount = ethers.utils.parseEther("1");
    const mintTx = await afEth.deposit({ value: depositAmount });
    await mintTx.wait();
  });
});
