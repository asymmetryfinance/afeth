import { parseBalanceMap } from "../../merkle_helpers/parse-balance-map";

type TokenAddress = string;
type RecipientAddress = string;
type Amount = string;

export const generateMockMerkleData = async (
  recipientAmounts: Record<RecipientAddress, Amount>
) => {
  const alcx = "0xdbdb4d16eda451d0503b854cf79d55697f90c8df";
  const clev = "0x72953a5C32413614d24C29c84a66AE4B59581Bbf";
  const cnc = "0x9aE380F0272E2162340a5bB646c354271c0F5cFC";
  const crv = "0xD533a949740bb3306d119CC777fa900bA034cd52";
  const cvx = "0x4e3fbd56cd56c3e72c1403e103b45db9da5b9d2b";
  const fxs = "0x3432b6a60d23ca0dfca7761b7ab56459d9c964d0";
  const gno = "0x6810e776880C02933D47DB1b9fc05908e5386b96";
  const inv = "0x41D5D79431A913C4aE7d69a668ecdfE5fF9DFB68";
  const met = "0x2Ebd53d035150f328bd754D6DC66B99B0eDB89aa";
  const ogv = "0x9c354503C38481a7A7a51629142963F98eCC12D0";
  const spell = "0x090185f2135308bad17527004364ebcc2d37e5f6";
  const stg = "0xaf5191b0de278c7286d6c7cc6ab6bb8a73ba2cd6";
  const tusd = "0x0000000000085d4780B73119b644AE5ecd22b376";
  const usdc = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  const usdd = "0x0C10bF8FcB7Bf5412187A595ab97a3609160b5c6";

  const tokenAddresses = [
    alcx,
    clev,
    cnc,
    crv,
    cvx,
    fxs,
    gno,
    inv,
    met,
    ogv,
    spell,
    stg,
    tusd,
    usdc,
    usdd,
  ];
  const proofData = {} as any;
  for (let i = 0; i < tokenAddresses.length; i++)
    proofData[tokenAddresses[i]] = await parseBalanceMap(recipientAmounts);
  return proofData;
};
