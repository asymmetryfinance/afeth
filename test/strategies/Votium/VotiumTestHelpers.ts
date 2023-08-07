import axios from "axios";
import { parseBalanceMap } from "../../merkle_helpers/parse-balance-map";

type RecipientAddress = string;
type Amount = string;

export const generateMockMerkleData = async (
  recipientAmounts: Record<RecipientAddress, Amount>
) => {
  const { data } = await axios.get(
    "https://raw.githubusercontent.com/oo-00/Votium/main/merkle/activeTokens.json"
  );
  const tokenAddresses = data.map((d: any) => d.value);
  const proofData = {} as any;
  for (let i = 0; i < tokenAddresses.length; i++)
    proofData[tokenAddresses[i]] = await parseBalanceMap(recipientAmounts);
  return proofData;
};
