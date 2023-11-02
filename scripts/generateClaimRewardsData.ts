import clone from "git-clone/promise.js";
import Fs from "@supercharge/fs";
import BigNumber from "bignumber.js";
import yesno from "yesno";
import { ethers } from "hardhat";
import { votiumMultiMerkleStashAbi } from "../test/abis/votiumMerkleStashAbi";

// (async function main() {
//   await clone("https://github.com/oo-00/Votium.git", "./votium");
//   // console.log("Cloning votium merkle data repo...");
//   // const proofs = await getProofsFromVotiumGithub();
//   // console.log("Repo cloned, getting proofs from local data...");
//   // console.log(JSON.stringify(proofs));
// })()
//   .then(() => process.exit(0))
//   .catch((error) => {
//     console.error(error);
//     process.exit(1);
//   });

export async function getProofsFromVotiumGithub() {
  const files = await Fs.files("./votium/merkle"); // use allFiles to recursively search
  const proofs: any = [];
  const addresses = await Fs.content("./votium/merkle/activeTokens.json");
  const address = "0xb5D336912EB99d0eA05F499172F39768afab8D4b";

  const accounts = await ethers.getSigners();
  const votiumMerkleStash = new ethers.Contract(
    "0x378Ba9B73309bE80BF4C2c027aAD799766a7ED5A",
    votiumMultiMerkleStashAbi,
    accounts[0]
  );

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (file.includes(".")) {
      return proofs;
    }
    const fileContentString = Fs.readFileSync(
      "./votium/merkle/" + file + "/" + file + ".json"
    ).toString();
    if (fileContentString.includes(address)) {
      const json = JSON.parse(fileContentString);
      const data = json?.claims?.[address];
      if (!data) return;
      const symbol = file;
      const tokenAddress = JSON.parse(addresses).find(
        (a: any) => a.symbol === symbol
      );
      if (!tokenAddress) throw new Error(`No address found for ${symbol}`);
      else {
        const isAlreadyClaimed = await votiumMerkleStash.isClaimed(
          tokenAddress.value,
          data.index
        );

        if (isAlreadyClaimed) continue;

        const normalizedClaimableAmount = new BigNumber(data.amount)
          .dividedBy(new BigNumber(10).pow(tokenAddress.decimals))
          .toString();

        const include = await yesno({
          question: `${tokenAddress.value} ${tokenAddress.symbol} ${normalizedClaimableAmount}  (include? y/n)`,
        });
        if (include) {
          const proofData = [
            tokenAddress.value,
            data.index,
            data.amount,
            data.proof,
          ];
          proofs.push(proofData);
        }
      }
    }
  }

  return proofs;
}
