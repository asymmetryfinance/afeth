import { ethers } from "hardhat";
import { stEthAbi } from "./abis/stEthAbi";

describe.only("Test Cow Hooks", async function () {
  const STETH_ADDRESS = "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84";

  it("Should permit & swap stEth to Eth, then deposit into AfEth", async function () {
    const { chainId } = await ethers.provider.getNetwork();
    console.log("Chain ID", chainId);
    if (!process.env.PRIVATE_KEY) throw new Error("No private key found");
    const key: any = process.env.PRIVATE_KEY;
    const wallet = new ethers.Wallet(key, ethers.provider); // accounts[0];
    const SETTLEMENT = new ethers.Contract(
      "0x9008D19f58AAbD9eD0D60971565AA8510560ab41",
      [],
      ethers.provider
    );

    const VAULT_RELAYER = new ethers.Contract(
      "0xC92E8bdf79f0507f65a392b0ab4667716BFE0110",
      [],
      ethers.provider
    );

    const WETH = new ethers.Contract(
      "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
      [],
      ethers.provider
    );

    const STETH = new ethers.Contract(STETH_ADDRESS, stEthAbi, ethers.provider);
    const sellAmount = ethers.utils.parseEther(".15").toString();

    /** Order Configuration **/

    const orderConfig = {
      sellToken: STETH.address,
      buyToken: WETH.address, // withdraw to ETH
      sellAmount,
      kind: "sell",
      partiallyFillable: false,
      sellTokenBalance: "erc20",
      buyTokenBalance: "erc20",
    } as any;

    /** EIP-2612 Permit **/

    const permit = {
      owner: wallet.address,
      spender: VAULT_RELAYER.address,
      value: orderConfig.sellAmount,
      nonce: await STETH.nonces(wallet.address),
      deadline: ethers.constants.MaxUint256,
    };
    const permitSignature = ethers.utils.splitSignature(
      await wallet._signTypedData(
        {
          name: await STETH.name(),
          version: "2",
          chainId,
          verifyingContract: STETH.address,
        },
        {
          Permit: [
            { name: "owner", type: "address" },
            { name: "spender", type: "address" },
            { name: "value", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
          ],
        },
        permit
      )
    );
    const permitParams = [
      permit.owner,
      permit.spender,
      permit.value,
      permit.deadline,
      permitSignature.v,
      permitSignature.r,
      permitSignature.s,
    ];
    const permitHook = {
      target: STETH.address,
      callData: STETH.interface.encodeFunctionData("permit", permitParams),
      gasLimit: `${await STETH.estimateGas.permit(...permitParams)}`,
    };
    console.log("permit hook:", permitHook);

    /** AfEth Deposit **/

    orderConfig.receiver = wallet.address;

    // orderConfig.receiver = afEthRelayer.address;
    // const depositHook = {
    //   target: afEth.address,
    //   callData: afEth.interface.encodeFunctionData("depositSafEth", [
    //     0,
    //     wallet.address,
    //   ]),
    //   gasLimit: "2285300", // TODO: set gas limit
    // };
    // console.log("deposit hook:", depositHook);

    /** Order Creation **/

    orderConfig.appData = JSON.stringify({
      metadata: {
        hooks: {
          pre: [permitHook],
          //   post: [depositHook],
        },
      },
    });

    const { id: quoteId, quote } = await fetch(
      "https://barn.api.cow.fi/mainnet/api/v1/quote",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: wallet.address,
          sellAmountBeforeFee: orderConfig.sellAmount,
          ...orderConfig,
        }),
      }
    ).then(async (response) => {
      return response.json();
    });
    console.log("quote:", quoteId, quote);

    const orderData = {
      ...orderConfig,
      sellAmount: quote.sellAmount,
      buyAmount: `${ethers.BigNumber.from(quote.buyAmount)
        .mul(99)
        .div(100)
        .toString()}`,
      validTo: quote.validTo,
      appData: ethers.utils.id(orderConfig.appData),
      feeAmount: quote.feeAmount,
    };
    console.log("TRY SIGN");
    const orderSignature = await wallet._signTypedData(
      {
        name: "Gnosis Protocol",
        version: "v2",
        chainId,
        verifyingContract: SETTLEMENT.address,
      },
      {
        Order: [
          { name: "sellToken", type: "address" },
          { name: "buyToken", type: "address" },
          { name: "receiver", type: "address" },
          { name: "sellAmount", type: "uint256" },
          { name: "buyAmount", type: "uint256" },
          { name: "validTo", type: "uint32" },
          { name: "appData", type: "bytes32" },
          { name: "feeAmount", type: "uint256" },
          { name: "kind", type: "string" },
          { name: "partiallyFillable", type: "bool" },
          { name: "sellTokenBalance", type: "string" },
          { name: "buyTokenBalance", type: "string" },
        ],
      },
      orderData
    );

    console.log("Signature:", orderSignature);

    const orderUid = await fetch(
      "https://barn.api.cow.fi/mainnet/api/v1/orders",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ...orderData,
          from: wallet.address,
          appData: orderConfig.appData,
          appDataHash: orderData.appData,
          signingScheme: "eip712",
          signature: orderSignature,
          quoteId,
        }),
      }
    ).then((response) => response.json());
    console.log("order:", orderUid);
  });
});
