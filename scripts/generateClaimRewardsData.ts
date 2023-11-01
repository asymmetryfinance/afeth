import clone from "git-clone/promise.js";
import Fs from "@supercharge/fs";

(async function main() {
  console.log("Cloning votium merkle data repo...");
  await clone("https://github.com/oo-00/Votium.git", "./votium");

  console.log("Repo cloned, getting proofs from local data...");
  const proofs = await getProofsFromLocalData();

  console.log("Proof Data:", JSON.stringify(proofs));
})()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

async function getProofsFromLocalData() {
  const files = await Fs.files("./votium/merkle"); // use allFiles to recursively search
  const proofs: any = [];
  const addresses = await Fs.content("./votium/merkle/activeTokens.json");
  const address = "0xb5D336912EB99d0eA05F499172F39768afab8D4b";
  files.forEach(async (file) => {
    if (file.includes(".")) return;
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
        proofs.push([tokenAddress.value, data.index, data.amount, data.proof]);
      }
    }
  });
  return proofs;
}
