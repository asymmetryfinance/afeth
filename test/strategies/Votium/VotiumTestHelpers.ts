import axios from "axios";
import { parseBalanceMap } from "../../merkle_helpers/parse-balance-map";
import { ethers } from "hardhat";
import ERC20 from "@openzeppelin/contracts/build/contracts/ERC20.json";

export const generateMockMerkleData = async (recipients: string[]) => {
  const votiumRewardsContractAddress =
    "0x378Ba9B73309bE80BF4C2c027aAD799766a7ED5A";
  const { data } = await axios.get(
    "https://raw.githubusercontent.com/oo-00/Votium/main/merkle/activeTokens.json"
  );
  const tokenAddresses = data.map((d: any) => d.value);
  const accounts = await ethers.getSigners();

  const balances: any[] = [];
  for (let i = 0; i < tokenAddresses.length; i++) {
    const contract = new ethers.Contract(
      tokenAddresses[i],
      ERC20.abi,
      accounts[0]
    );
    const balanceBeforeClaim = await contract.balanceOf(
      votiumRewardsContractAddress
    );

    balances.push(balanceBeforeClaim);
  }
  const proofData = {} as any;
  for (let i = 0; i < tokenAddresses.length; i++) {
    const recipientAmounts = {} as any;
    for (let j = 0; j < recipients.length; j++)
      recipientAmounts[recipients[j]] = balances[i].div(recipients.length);
    proofData[tokenAddresses[i]] = await parseBalanceMap(recipientAmounts);
  }
  return proofData;
};
