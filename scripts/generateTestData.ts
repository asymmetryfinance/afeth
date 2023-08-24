import * as path from "path";
import * as fs from "fs";
import { generateMockProofsAndSwaps } from "./applyVotiumRewardsHelpers";
import { BigNumber } from "ethers";

function writeJSONToFile(obj: any, filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const jsonString = JSON.stringify(obj, null, 2);
    fs.writeFile(path.resolve(filePath), jsonString, "utf8", (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

async function main() {
  // address of VotiumStrategy contract that will be used in the tests
  const expectedVotiumStrategyAddress =
    "0x64f5219563e28EeBAAd91Ca8D31fa3b36621FD4f";
  const recipients = [
    expectedVotiumStrategyAddress,
    "0x8a65ac0E23F31979db06Ec62Af62b132a6dF4741",
    "0x0000462df2438f7b39577917374b1565c306b908",
    "0x000051d46ff97559ed5512ac9d2d95d0ef1140e1",
    "0xc90c5cc170a8db4c1b66939e1a0bb9ad47c93602",
    "0x47CB53752e5dc0A972440dA127DCA9FBA6C2Ab6F",
    "0xe7ebef64f1ff602a28d8d37049e46d0ca77a38ac",
    "0x76a1f47f8d998d07a15189a07d9aada180e09ac6",
  ];

  const mockProofsAndSwaps = await generateMockProofsAndSwaps(
    recipients,
    expectedVotiumStrategyAddress,
    BigNumber.from(10)
  );

  await writeJSONToFile(
    mockProofsAndSwaps,
    path.resolve(__dirname, "testData.json")
  );
}

main()
  .then(() => {
    return process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
